import {
  expandOperatorModules,
  invalidOperatorModules,
  permissionCodesForRole,
  resolveEffectivePermissions,
} from '@aiecom/shared';

describe('operator module permissions', () => {
  it('always grants dashboard and self-tenant data even with no modules', () => {
    expect(expandOperatorModules([])).toEqual(expect.arrayContaining(['menu:dashboard', 'data:tenant:self']));
    expect(expandOperatorModules([])).not.toContain('crawler:task:list');
    expect(expandOperatorModules([])).not.toContain('menu:user');
  });

  it('expands crawler module to task actions but not IAM', () => {
    const codes = expandOperatorModules(['menu:crawler']);
    expect(codes).toEqual(
      expect.arrayContaining([
        'menu:dashboard',
        'menu:crawler',
        'crawler:task:list',
        'crawler:task:create',
        'crawler:task:retry',
        'crawler:task:export',
      ]),
    );
    expect(codes).not.toContain('user:list');
    expect(codes).not.toContain('menu:product');
  });

  it('grants shop:list with product module for shelf shop picker', () => {
    const codes = expandOperatorModules(['menu:product']);
    expect(codes).toEqual(
      expect.arrayContaining(['menu:product', 'product:list', 'product:shelf', 'product:delete', 'shop:list']),
    );
    expect(codes).not.toContain('shop:create');
    expect(codes).not.toContain('menu:shop');
  });

  it('rejects modules outside the operator ceiling', () => {
    expect(invalidOperatorModules(['menu:crawler', 'menu:tenant', 'tenant:create'])).toEqual([
      'menu:tenant',
      'tenant:create',
    ]);
  });

  it('uses role templates for admins and ignores assigned modules', () => {
    const assigned = ['menu:crawler'];
    const superPerms = resolveEffectivePermissions(['SUPER_ADMIN'], assigned);
    const tenantPerms = resolveEffectivePermissions(['TENANT_ADMIN'], assigned);
    expect(superPerms).toEqual(expect.arrayContaining(['tenant:create', 'menu:role', 'menu:user']));
    expect(tenantPerms).toEqual(permissionCodesForRole('TENANT_ADMIN'));
    expect(tenantPerms).toContain('menu:user');
    expect(tenantPerms).toContain('menu:shop');
    expect(tenantPerms).not.toContain('menu:product-review');
    expect(tenantPerms).not.toContain('product:review');
    expect(tenantPerms).not.toContain('tenant:create');
    expect(tenantPerms).not.toContain('shop:create');
    expect(tenantPerms).not.toContain('shop:update');
  });

  it('resolves operator from assigned modules instead of the full role template', () => {
    const codes = resolveEffectivePermissions(['OPERATOR'], ['menu:order']);
    expect(codes).toContain('order:create');
    expect(codes).not.toContain('crawler:task:list');
    expect(permissionCodesForRole('OPERATOR')).toContain('crawler:task:list');
  });
});
