import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { RoleCode, UserStatus } from '@prisma/client';
import { hash } from 'bcryptjs';
import { invalidOperatorModules } from '@aiecom/shared';
import { PageQueryDto, PageResult } from '../../common/dto/page-query.dto';
import { PrismaService } from '../../common/prisma/prisma.service';
import { ShopAccessService } from '../../common/shop/shop-access.service';
import { canAssignRole, requireTenantId } from '../../common/tenant/tenant-scope';
import { AuthUser } from '../auth/auth.types';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';

const USER_LIST_SELECT = {
  id: true,
  username: true,
  realName: true,
  email: true,
  phone: true,
  status: true,
  tenantId: true,
  lastLoginAt: true,
  createdAt: true,
  tenant: { select: { id: true, name: true, code: true } },
  userRoles: {
    include: { role: true, tenant: { select: { id: true, name: true, code: true } } },
  },
  shopAccesses: {
    select: { shopId: true, shop: { select: { id: true, name: true, platform: true, status: true } } },
  },
  moduleAccesses: {
    select: { permission: { select: { code: true, name: true } } },
  },
} as const;

@Injectable()
export class UserService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly shopAccess: ShopAccessService,
  ) {}

  async page(
    actor: AuthUser,
    tenantId: string | null,
    query: PageQueryDto & { keyword?: string; status?: UserStatus },
  ): Promise<PageResult<unknown>> {
    const scopedTenantId = actor.roles.includes('SUPER_ADMIN')
      ? tenantId
      : requireTenantId(actor.tenantId);

    const where = {
      ...(scopedTenantId ? { tenantId: scopedTenantId } : { tenantId: { not: null } }),
      ...(query.status ? { status: query.status } : {}),
      ...(query.keyword
        ? {
            OR: [
              { username: { contains: query.keyword, mode: 'insensitive' as const } },
              { realName: { contains: query.keyword, mode: 'insensitive' as const } },
            ],
          }
        : {}),
    };

    const [list, total] = await this.prisma.$transaction([
      this.prisma.user.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        select: USER_LIST_SELECT,
      }),
      this.prisma.user.count({ where }),
    ]);

    return { list, total, page: query.page, pageSize: query.pageSize };
  }

  async create(actor: AuthUser, requestTenantId: string | null, dto: CreateUserDto) {
    if (!canAssignRole(actor.roles, dto.roleCode)) {
      throw new ForbiddenException('无权分配该角色');
    }

    const tenantId = actor.roles.includes('SUPER_ADMIN')
      ? requireTenantId(dto.tenantId ?? requestTenantId)
      : requireTenantId(actor.tenantId);

    if (!actor.roles.includes('SUPER_ADMIN') && dto.tenantId && dto.tenantId !== actor.tenantId) {
      throw new ForbiddenException('禁止跨租户创建用户');
    }

    const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId } });
    if (!tenant || tenant.status !== 'ACTIVE') {
      throw new ForbiddenException('租户不存在或已停用');
    }

    const role = await this.prisma.role.findUnique({ where: { code: dto.roleCode as RoleCode } });
    if (!role) {
      throw new NotFoundException('角色不存在');
    }

    await this.shopAccess.assertShopsInTenant(tenantId, dto.shopIds ?? []);
    const moduleRows =
      dto.roleCode === 'OPERATOR' ? await this.resolveModuleRows(tenantId, dto.moduleCodes ?? []) : [];

    return this.prisma.user.create({
      data: {
        tenantId,
        username: dto.username,
        passwordHash: await hash(dto.password, 12),
        realName: dto.realName,
        email: dto.email,
        phone: dto.phone,
        userRoles: {
          create: { roleId: role.id, tenantId },
        },
        shopAccesses: dto.shopIds?.length
          ? { create: dto.shopIds.map((shopId) => ({ shopId, tenantId })) }
          : undefined,
        moduleAccesses: moduleRows.length ? { create: moduleRows } : undefined,
      },
      select: USER_LIST_SELECT,
    });
  }

  async update(actor: AuthUser, requestTenantId: string | null, id: string, dto: UpdateUserDto) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      include: { userRoles: { include: { role: true } } },
    });
    if (!user) {
      throw new NotFoundException('用户不存在');
    }
    this.assertCanManage(actor, requestTenantId, user.tenantId);

    if (dto.shopIds && user.tenantId) {
      await this.shopAccess.assertShopsInTenant(user.tenantId, dto.shopIds);
    }

    const isOperator = user.userRoles.some((item) => item.role.code === 'OPERATOR');
    const moduleRows =
      dto.moduleCodes && isOperator && user.tenantId
        ? await this.resolveModuleRows(user.tenantId, dto.moduleCodes)
        : null;

    return this.prisma.$transaction(async (tx) => {
      if (dto.shopIds && user.tenantId) {
        await tx.userShopAccess.deleteMany({ where: { userId: id, tenantId: user.tenantId } });
        if (dto.shopIds.length) {
          await tx.userShopAccess.createMany({
            data: dto.shopIds.map((shopId) => ({ userId: id, shopId, tenantId: user.tenantId as string })),
          });
        }
      }
      if (moduleRows && user.tenantId) {
        await tx.userPermission.deleteMany({ where: { userId: id, tenantId: user.tenantId } });
        if (moduleRows.length) {
          await tx.userPermission.createMany({
            data: moduleRows.map((row) => ({ userId: id, ...row })),
          });
        }
      }
      return tx.user.update({
        where: { id },
        data: {
          realName: dto.realName,
          email: dto.email,
          phone: dto.phone,
          status: dto.status,
        },
        select: USER_LIST_SELECT,
      });
    });
  }

  private async resolveModuleRows(tenantId: string, moduleCodes: string[]) {
    const invalid = invalidOperatorModules(moduleCodes);
    if (invalid.length) {
      throw new BadRequestException(`不可分配的模块: ${invalid.join(', ')}`);
    }
    if (!moduleCodes.length) {
      return [];
    }
    const permissions = await this.prisma.permission.findMany({
      where: { code: { in: moduleCodes } },
      select: { id: true, code: true },
    });
    if (permissions.length !== new Set(moduleCodes).size) {
      throw new BadRequestException('存在未知模块权限');
    }
    return permissions.map((item) => ({ permissionId: item.id, tenantId }));
  }

  private assertCanManage(actor: AuthUser, requestTenantId: string | null, targetTenantId: string | null) {
    if (actor.roles.includes('SUPER_ADMIN')) {
      return;
    }
    const tenantId = requireTenantId(actor.tenantId);
    if (targetTenantId !== tenantId || (requestTenantId && requestTenantId !== tenantId)) {
      throw new ForbiddenException('禁止跨租户操作用户');
    }
  }
}
