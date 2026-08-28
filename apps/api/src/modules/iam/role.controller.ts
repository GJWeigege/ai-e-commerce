import { Controller, Get } from '@nestjs/common';
import { RequirePermissions, SkipTenant } from '../../common/decorators/auth.decorators';
import { CurrentUser } from '../../common/decorators/current.decorators';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuthUser } from '../auth/auth.types';

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
  async catalog(@CurrentUser() actor: AuthUser) {
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
    const visible = actor.roles.includes('SUPER_ADMIN')
      ? roles
      : roles.filter((role) => role.code !== 'SUPER_ADMIN');
    return visible.map((role) => ({
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
