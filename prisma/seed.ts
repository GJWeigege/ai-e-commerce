import { PrismaClient, RoleCode } from '@prisma/client';
import { hashSync } from 'bcryptjs';
import { PERMISSIONS, permissionCodesForRole, OPERATOR_ASSIGNABLE_MODULE_CODES } from '../packages/shared/src/permissions';

const prisma = new PrismaClient();

async function main() {
  const isProd = process.env.NODE_ENV === 'production';
  const adminPassword = process.env.SEED_ADMIN_PASSWORD || (isProd ? '' : 'Admin@123456');
  const demoPassword = process.env.SEED_DEMO_PASSWORD || (isProd ? '' : 'Demo@123456');
  const adminUsername = process.env.SEED_ADMIN_USERNAME || 'admin';
  if (isProd) {
    if (!adminPassword || adminPassword.length < 12 || !demoPassword || demoPassword.length < 12) {
      throw new Error('生产环境 RUN_SEED 必须设置至少 12 位的 SEED_ADMIN_PASSWORD 与 SEED_DEMO_PASSWORD');
    }
  }

  const roles = await Promise.all(
    (
      [
        { code: RoleCode.SUPER_ADMIN, name: '超级管理员' },
        { code: RoleCode.TENANT_ADMIN, name: '租户管理员' },
        { code: RoleCode.OPERATOR, name: '普通操作员' },
      ] as const
    ).map((item) =>
      prisma.role.upsert({
        where: { code: item.code },
        update: { name: item.name },
        create: { code: item.code, name: item.name, isSystem: true },
      }),
    ),
  );

  const permissionRecords = [];
  for (const def of PERMISSIONS) {
    const record = await prisma.permission.upsert({
      where: { code: def.code },
      update: {
        name: def.name,
        type: def.type,
        resource: def.resource,
        sortOrder: def.sortOrder,
      },
      create: {
        code: def.code,
        name: def.name,
        type: def.type,
        resource: def.resource,
        sortOrder: def.sortOrder,
      },
    });
    permissionRecords.push(record);
  }

  const permissionByCode = new Map(permissionRecords.map((item) => [item.code, item]));

  for (const role of roles) {
    const codes = permissionCodesForRole(role.code);
    for (const code of codes) {
      const permission = permissionByCode.get(code);
      if (!permission) {
        throw new Error(`权限点不存在: ${code}`);
      }
      await prisma.rolePermission.upsert({
        where: {
          roleId_permissionId: { roleId: role.id, permissionId: permission.id },
        },
        update: {},
        create: { roleId: role.id, permissionId: permission.id },
      });
    }
    await prisma.rolePermission.deleteMany({
      where: {
        roleId: role.id,
        permission: { code: { notIn: codes } },
      },
    });
  }

  const superRole = roles.find((item) => item.code === RoleCode.SUPER_ADMIN);
  if (!superRole) {
    throw new Error('超级管理员角色未创建');
  }

  const admin = await prisma.user.upsert({
    where: { username: adminUsername },
    update: {},
    create: {
      username: adminUsername,
      passwordHash: hashSync(adminPassword, 10),
      realName: '系统超管',
      status: 'ACTIVE',
    },
  });

  await prisma.userRole.upsert({
    where: { userId_roleId: { userId: admin.id, roleId: superRole.id } },
    update: {},
    create: { userId: admin.id, roleId: superRole.id },
  });

  const demoTenant = await prisma.tenant.upsert({
    where: { code: 'DEMO' },
    update: { name: '演示租户' },
    create: {
      name: '演示租户',
      code: 'DEMO',
      status: 'ACTIVE',
      remark: '本地开发演示租户',
      isolationMode: 'SHARED',
    },
  });

  const tenantAdminRole = roles.find((item) => item.code === RoleCode.TENANT_ADMIN);
  const operatorRole = roles.find((item) => item.code === RoleCode.OPERATOR);
  if (!tenantAdminRole || !operatorRole) {
    throw new Error('租户角色未创建');
  }

  const demoAdmin = await prisma.user.upsert({
    where: { username: 'demo_admin' },
    update: { tenantId: demoTenant.id },
    create: {
      tenantId: demoTenant.id,
      username: 'demo_admin',
      passwordHash: hashSync(demoPassword, 10),
      realName: '演示租户管理员',
      status: 'ACTIVE',
    },
  });

  await prisma.userRole.upsert({
    where: { userId_roleId: { userId: demoAdmin.id, roleId: tenantAdminRole.id } },
    update: { tenantId: demoTenant.id },
    create: { userId: demoAdmin.id, roleId: tenantAdminRole.id, tenantId: demoTenant.id },
  });

  const demoOperator = await prisma.user.upsert({
    where: { username: 'demo_op' },
    update: { tenantId: demoTenant.id },
    create: {
      tenantId: demoTenant.id,
      username: 'demo_op',
      passwordHash: hashSync(demoPassword, 10),
      realName: '演示操作员',
      status: 'ACTIVE',
    },
  });

  await prisma.userRole.upsert({
    where: { userId_roleId: { userId: demoOperator.id, roleId: operatorRole.id } },
    update: { tenantId: demoTenant.id },
    create: { userId: demoOperator.id, roleId: operatorRole.id, tenantId: demoTenant.id },
  });

  for (const code of OPERATOR_ASSIGNABLE_MODULE_CODES) {
    const permission = permissionByCode.get(code);
    if (!permission) {
      throw new Error(`权限点不存在: ${code}`);
    }
    await prisma.userPermission.upsert({
      where: { userId_permissionId: { userId: demoOperator.id, permissionId: permission.id } },
      update: { tenantId: demoTenant.id },
      create: { userId: demoOperator.id, permissionId: permission.id, tenantId: demoTenant.id },
    });
  }

  await prisma.warehouse.upsert({
    where: { tenantId_code: { tenantId: demoTenant.id, code: 'LOCAL-FULFILLMENT' } },
    update: {},
    create: {
      tenantId: demoTenant.id,
      type: 'LOCAL_FULFILLMENT',
      code: 'LOCAL-FULFILLMENT',
      name: '俄罗斯代发仓',
      address: 'Moscow, RU',
      enabled: true,
    },
  });

  await prisma.warehouse.upsert({
    where: { tenantId_code: { tenantId: demoTenant.id, code: 'WB-OFFICIAL' } },
    update: {},
    create: {
      tenantId: demoTenant.id,
      type: 'WB_OFFICIAL',
      code: 'WB-OFFICIAL',
      name: 'Wildberries 官方仓（中转）',
      enabled: true,
    },
  });

  console.log('Seed completed');
  if (isProd) {
    console.log('  admin accounts created (passwords are not logged)');
  } else {
    console.log(`  super admin: ${adminUsername} / ${adminPassword}`);
    console.log(`  demo admin : demo_admin / ${demoPassword}`);
    console.log(`  demo operator: demo_op / ${demoPassword}`);
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
