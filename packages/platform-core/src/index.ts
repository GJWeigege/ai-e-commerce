export type PlacePurchaseInput = {
  skuId: string;
  quantity: number;
  credentialRef: string;
};

export type PlacePurchaseResult = {
  ozonOrderNo: string;
  success: boolean;
  failReason?: string;
};

export interface IOzonAdapter {
  placePurchase(input: PlacePurchaseInput): Promise<PlacePurchaseResult>;
}

export interface IWbAdapter {
  createTransfer(input: { ozonOrderNo: string; quantity: number }): Promise<{ wbTrackingNo: string }>;
}

export class StubOzonAdapter implements IOzonAdapter {
  async placePurchase(_input: PlacePurchaseInput): Promise<PlacePurchaseResult> {
    throw new Error('Ozon 采购尚未对接真实 Seller API，请配置正式适配器后再推进代采');
  }
}

export class StubWbAdapter implements IWbAdapter {
  async createTransfer(_input: { ozonOrderNo: string; quantity: number }): Promise<{ wbTrackingNo: string }> {
    throw new Error('Wildberries 中转尚未对接真实供应 API，请配置正式适配器后再推进物流');
  }
}

export * from './wb-listing.types';
export * from './wb-rate-limiter';
export * from './wb-listing.mapper';
export * from './wb-listing.client';
export * from './wb-listing.adapter';
export * from './wb-catalog.store';
export * from './wb-sdk.transport';
