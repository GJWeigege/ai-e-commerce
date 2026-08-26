import { advancePurchaseStatus, salesStatusForPurchase } from './order-status';

describe('purchase status machine', () => {
  it('advances along the happy path', () => {
    expect(advancePurchaseStatus('PENDING_PURCHASE')).toBe('PURCHASE_SUCCESS');
    expect(advancePurchaseStatus('PURCHASE_SUCCESS')).toBe('SHIPPED_TO_WB');
    expect(advancePurchaseStatus('SHIPPED_TO_WB')).toBe('ARRIVED_WB');
    expect(advancePurchaseStatus('ARRIVED_WB')).toBeNull();
    expect(advancePurchaseStatus('PURCHASE_FAILED')).toBeNull();
  });

  it('maps purchase status onto sales order', () => {
    expect(salesStatusForPurchase('PENDING_PURCHASE')).toBe('PURCHASE_PENDING');
    expect(salesStatusForPurchase('PURCHASE_SUCCESS')).toBe('PURCHASING');
    expect(salesStatusForPurchase('PURCHASE_FAILED')).toBe('EXCEPTION');
    expect(salesStatusForPurchase('SHIPPED_TO_WB')).toBe('IN_TRANSIT_WB');
    expect(salesStatusForPurchase('ARRIVED_WB')).toBe('ARRIVED_WB');
  });
});
