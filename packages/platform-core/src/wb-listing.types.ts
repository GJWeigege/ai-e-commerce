export type WbListingMode = 'live';

export type WbSubject = {
  subjectID: number;
  subjectName: string;
  parentID?: number;
  parentName?: string;
  /** WB 类目是否按尺码建卡；false 时禁止填写 Размер / Рос.Размер */
  isSize?: boolean;
};

export type WbCharacteristicMeta = {
  charcID: number;
  name: string;
  required: boolean;
  unitName?: string;
  maxCount?: number;
  charcType?: number;
};

export type WbDirectoryItem = {
  name: string;
  hex?: string;
};

export type WbCardSize = {
  techSize?: string;
  wbSize?: string;
  price: number;
  skus: string[];
};

export type WbCardCharacteristic = {
  id: number;
  value: string[] | number;
};

export type WbCardUploadItem = {
  subjectID: number;
  variants: Array<{
    vendorCode: string;
    title: string;
    description: string;
    brand: string;
    dimensions?: {
      length?: number;
      width?: number;
      height?: number;
      weightBrutto?: number;
    };
    characteristics: WbCardCharacteristic[];
    sizes: WbCardSize[];
  }>;
};

export type WbProductDraft = {
  skuId: string;
  name: string;
  brand?: string | null;
  description?: string | null;
  categoryPath?: string | null;
  price: number;
  stock?: number;
  imageUrls: string[];
  specs: Array<{ name: string; value: string }>;
  skuOptions: Array<{
    skuId: string;
    name: string;
    price: number;
    options?: Record<string, string>;
    imageUrls?: string[];
  }>;
};

export type WbListProductResult = {
  mode: WbListingMode;
  vendorCode: string;
  subjectID?: number;
  subjectName?: string;
  nmId?: number;
  imtId?: number;
  barcodes?: string[];
  uploaded: boolean;
  warnings?: string[];
};

export type WbCardRef = {
  nmId: number;
  imtId?: number;
  vendorCode: string;
  subjectID?: number;
  subjectName?: string;
  title?: string;
  sizes?: Array<{ chrtID?: number; techSize: string; wbSize?: string; skus: string[] }>;
};

export type WbCardUpdateItem = {
  nmID: number;
  vendorCode: string;
  title: string;
  description: string;
  brand: string;
  dimensions?: WbCardUploadItem['variants'][number]['dimensions'];
  characteristics: WbCardCharacteristic[];
  sizes: Array<{ chrtID?: number; techSize?: string; wbSize?: string; skus: string[]; price?: number }>;
};

export interface IWbListingAdapter {
  readonly mode: WbListingMode;
  listProduct(draft: WbProductDraft): Promise<WbListProductResult>;
  findCard(vendorCode: string): Promise<WbCardRef | null>;
  listErrors(vendorCode?: string): Promise<string[]>;
  saveMedia(nmId: number, urls: string[]): Promise<void>;
  setPrice(nmId: number, price: number, discount?: number): Promise<void>;
  setStocks(barcodes: string[], amount: number, warehouseId?: number): Promise<number>;
  unlist(nmIds: number[]): Promise<void>;
}
