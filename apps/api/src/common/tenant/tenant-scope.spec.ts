import {
  AccountUnboundException,
  CrossTenantException,
  TenantRequiredException,
  assertTenantMatch,
  canAssignRole,
  requireTenantId,
  resolveRequestTenantId,
  canAccessAllTenantShops,
  canManageTenantShops,
} from './tenant-scope';

describe('resolveRequestTenantId', () => {
  const tenantA = 'tenant-a';
  const tenantB = 'tenant-b';

  it('binds a normal user to their own tenant', () => {
    expect(
      resolveRequestTenantId({
        userTenantId: tenantA,
        isSuperAdmin: false,
      }),
    ).toBe(tenantA);
  });

  it('rejects a normal user switching to another tenant via header', () => {
    expect(() =>
      resolveRequestTenantId({
        userTenantId: tenantA,
        isSuperAdmin: false,
        headerTenantId: tenantB,
      }),
    ).toThrow(CrossTenantException);
  });

  it('allows super admin to omit tenant context', () => {
    expect(
      resolveRequestTenantId({
        userTenantId: null,
        isSuperAdmin: true,
      }),
    ).toBeNull();
  });

  it('allows super admin to select a working tenant via header', () => {
    expect(
      resolveRequestTenantId({
        userTenantId: null,
        isSuperAdmin: true,
        headerTenantId: tenantB,
      }),
    ).toBe(tenantB);
  });

  it('rejects an unbound non-admin account', () => {
    expect(() =>
      resolveRequestTenantId({
        userTenantId: null,
        isSuperAdmin: false,
      }),
    ).toThrow(AccountUnboundException);
  });
});

describe('assertTenantMatch / requireTenantId', () => {
  it('throws when row tenant does not match request tenant', () => {
    expect(() => assertTenantMatch('a', 'b')).toThrow(CrossTenantException);
  });

  it('passes when tenants match', () => {
    expect(() => assertTenantMatch('a', 'a')).not.toThrow();
  });

  it('requires tenant id for tenant-scoped operations', () => {
    expect(() => requireTenantId(null)).toThrow(TenantRequiredException);
    expect(requireTenantId('t-1')).toBe('t-1');
  });
});

describe('canAssignRole', () => {
  it('does not allow creating another super admin', () => {
    expect(canAssignRole(['SUPER_ADMIN'], 'SUPER_ADMIN')).toBe(false);
  });

  it('allows tenant admin to create operator and tenant admin', () => {
    expect(canAssignRole(['TENANT_ADMIN'], 'OPERATOR')).toBe(true);
    expect(canAssignRole(['TENANT_ADMIN'], 'TENANT_ADMIN')).toBe(true);
    expect(canAssignRole(['TENANT_ADMIN'], 'SUPER_ADMIN')).toBe(false);
  });

  it('forbids operators from assigning roles', () => {
    expect(canAssignRole(['OPERATOR'], 'OPERATOR')).toBe(false);
  });
});

describe('canAccessAllTenantShops', () => {
  it('grants tenant-wide shop access to super admin and tenant admin', () => {
    expect(canAccessAllTenantShops(['SUPER_ADMIN'])).toBe(true);
    expect(canAccessAllTenantShops(['TENANT_ADMIN'])).toBe(true);
    expect(canAccessAllTenantShops(['OPERATOR'])).toBe(false);
  });
});

describe('canManageTenantShops', () => {
  it('allows only super admin to create or rebind shops', () => {
    expect(canManageTenantShops(['SUPER_ADMIN'])).toBe(true);
    expect(canManageTenantShops(['TENANT_ADMIN'])).toBe(false);
    expect(canManageTenantShops(['OPERATOR'])).toBe(false);
  });
});
