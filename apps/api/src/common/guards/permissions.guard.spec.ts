import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PermissionsGuard } from './permissions.guard';
import { AuthUser } from '../../modules/auth/auth.types';

function mockContext(user?: AuthUser): ExecutionContext {
  return {
    getHandler: () => ({}),
    getClass: () => ({}),
    switchToHttp: () => ({
      getRequest: () => ({ user }),
    }),
  } as unknown as ExecutionContext;
}

describe('PermissionsGuard', () => {
  const operator: AuthUser = {
    id: 'u1',
    username: 'op',
    realName: 'op',
    tenantId: 't1',
    roles: ['OPERATOR'],
    permissions: ['user:list'],
  };

  it('allows super admin regardless of permission codes', () => {
    const reflector = {
      getAllAndOverride: (key: string) => {
        if (key === 'isPublic') return false;
        if (key === 'permissions') return ['tenant:create'];
        return undefined;
      },
    } as unknown as Reflector;
    const guard = new PermissionsGuard(reflector);
    const superAdmin: AuthUser = { ...operator, roles: ['SUPER_ADMIN'], permissions: [] };
    expect(guard.canActivate(mockContext(superAdmin))).toBe(true);
  });

  it('rejects operator missing required action permission', () => {
    const reflector = {
      getAllAndOverride: (key: string) => {
        if (key === 'isPublic') return false;
        if (key === 'permissions') return ['user:create'];
        return undefined;
      },
    } as unknown as Reflector;
    const guard = new PermissionsGuard(reflector);
    expect(() => guard.canActivate(mockContext(operator))).toThrow(ForbiddenException);
  });

  it('allows operator with matching permission', () => {
    const reflector = {
      getAllAndOverride: (key: string) => {
        if (key === 'isPublic') return false;
        if (key === 'permissions') return ['user:list'];
        return undefined;
      },
    } as unknown as Reflector;
    const guard = new PermissionsGuard(reflector);
    expect(guard.canActivate(mockContext(operator))).toBe(true);
  });
});
