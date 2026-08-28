import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY, SKIP_TENANT_KEY } from '../decorators/auth.decorators';
import { PrismaService } from '../prisma/prisma.service';
import { resolveRequestTenantId } from '../tenant/tenant-scope';
import { AuthUser } from '../../modules/auth/auth.types';

@Injectable()
export class TenantGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    const skipTenant = this.reflector.getAllAndOverride<boolean>(SKIP_TENANT_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    const request = context.switchToHttp().getRequest<{
      user?: AuthUser;
      headers: Record<string, string | string[] | undefined>;
      tenantId?: string | null;
    }>();
    const user = request.user;
    if (!user) {
      return false;
    }

    const rawHeader = request.headers['x-tenant-id'];
    const headerTenantId = Array.isArray(rawHeader) ? rawHeader[0] : rawHeader;

    if (skipTenant) {
      request.tenantId = user.tenantId;
      return true;
    }

    const tenantId = resolveRequestTenantId({
      userTenantId: user.tenantId,
      isSuperAdmin: user.roles.includes('SUPER_ADMIN'),
      headerTenantId,
    });
    if (tenantId) {
      const tenant = await this.prisma.tenant.findUnique({
        where: { id: tenantId },
        select: { status: true },
      });
      if (!tenant || tenant.status !== 'ACTIVE') {
        throw new ForbiddenException('租户不存在或已停用');
      }
    }
    request.tenantId = tenantId;
    return true;
  }
}
