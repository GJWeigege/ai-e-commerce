import { permissionCodesForRole } from '@aiecom/shared';

describe('shop permission matrix', () => {
  it('lets tenant admin view shops but not create or rebind them', () => {
    const admin = permissionCodesForRole('TENANT_ADMIN');
    const operator = permissionCodesForRole('OPERATOR');

    expect(admin).toEqual(expect.arrayContaining(['menu:shop', 'shop:list', 'product:shelf']));
    expect(admin).not.toContain('shop:create');
    expect(admin).not.toContain('shop:update');
    expect(admin).not.toContain('shop:disable');
    expect(operator).toContain('shop:list');
    expect(operator).toContain('product:shelf');
    expect(operator).not.toContain('menu:shop');
    expect(operator).not.toContain('shop:create');
    expect(operator).not.toContain('shop:update');
    expect(operator).not.toContain('shop:disable');
  });

  it('lets only super admin open and rebind shops for tenants', () => {
    const superAdmin = permissionCodesForRole('SUPER_ADMIN');
    expect(superAdmin).toEqual(
      expect.arrayContaining(['menu:shop', 'shop:list', 'shop:create', 'shop:update', 'shop:disable']),
    );
  });
});
