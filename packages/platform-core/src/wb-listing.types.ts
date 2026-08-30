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

/** 类目/尺码来源：hint 来自类目映射表，existing 沿用已建卡片（WB 不允许改类目） */
export type WbSubjectSource = 'hint' | 'search' | 'existing' | 'default';

/** 上架前置提示。命中映射表可跳过 WB 类目搜索，是批量上架最大的一块提速 */
export type WbListingHints = {
  subject?: { subjectID: number; subjectName: string };
  /** 该类目是否按尺码建卡；null/undefined 表示未知，由适配器自行判定 */
  sized?: boolean | null;
  /** 库里已记录的 nmID，命中后跳过货号反查与回收站恢复 */
  knownNmId?: number | null;
  /** 首次上架没有 nmID，不必扫回收站（省 2~4 次 POST） */
  skipTrashLookup?: boolean;
};

export type WbListProductResult = {
  mode: WbListingMode;
  vendorCode: string;
  subjectID?: number;
  subjectName?: string;
  subjectSource?: WbSubjectSource;
  nmId?: number;
  imtId?: number;
  barcodes?: string[];
  uploaded: boolean;
  /** 本次实际按尺码/无尺码建卡，供上层回写类目映射表 */
  sized?: boolean;
  /** 自愈动作说明，例如「已去掉 Размер 重建卡片」 */
  repairs?: string[];
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
  listProduct(draft: WbProductDraft, hints?: WbListingHints): Promise<WbListProductResult>;
  /** 按 Ozon 面包屑解析 WB 类目，供类目映射维护页做候选建议 */
  suggestSubjects(input: { categoryPath?: string | null; name?: string; keyword?: string }): Promise<WbSubject[]>;
  findCard(vendorCode: string): Promise<WbCardRef | null>;
  listErrors(vendorCode?: string): Promise<string[]>;
  saveMedia(nmId: number, urls: string[]): Promise<void>;
  setPrice(nmId: number, price: number, discount?: number): Promise<void>;
  setStocks(barcodes: string[], amount: number, warehouseId?: number): Promise<number>;
  unlist(nmIds: number[]): Promise<void>;
}
