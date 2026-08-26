import { Controller, Get } from '@nestjs/common';
import { RequirePermissions, SkipTenant } from '../../common/decorators/auth.decorators';
import { PrismaService } from '../../common/prisma/prisma.service';

@Controller('roles')
@SkipTenant()
export class RoleController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @RequirePermissions('user:list')
  list() {
    return this.prisma.role.findMany({
      where: { code: { not: 'SUPER_ADMIN' } },
      orderBy: { code: 'asc' },
      select: { id: true, code: true, name: true },
    });
  }

  @Get('catalog')
  @RequirePermissions('menu:role')
  async catalog() {
    const roles = await this.prisma.role.findMany({
      orderBy: { code: 'asc' },
      select: {
        id: true,
        code: true,
        name: true,
        isSystem: true,
        permissions: {
          select: {
            permission: {
              select: { code: true, name: true, type: true, resource: true, sortOrder: true },
            },
          },
        },
      },
    });
    return roles.map((role) => ({
      id: role.id,
      code: role.code,
      name: role.name,
      isSystem: role.isSystem,
      permissions: role.permissions
        .map((item) => item.permission)
        .sort((a, b) => a.sortOrder - b.sortOrder),
    }));
  }
}
