import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY, SKIP_TENANT_KEY } from '../decorators/auth.decorators';
import { resolveRequestTenantId } from '../tenant/tenant-scope';
import { AuthUser } from '../../modules/auth/auth.types';

@Injectable()
export class TenantGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
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

    request.tenantId = resolveRequestTenantId({
      userTenantId: user.tenantId,
      isSuperAdmin: user.roles.includes('SUPER_ADMIN'),
      headerTenantId,
    });
    return true;
  }
}
