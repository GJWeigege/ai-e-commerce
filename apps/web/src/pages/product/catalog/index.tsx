import { PageContainer, ProTable } from '@ant-design/pro-components';
import { Button, Checkbox, Form, Image, InputNumber, Modal, Radio, Select, Space, Tag, Tooltip, Typography, message } from 'antd';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { ActionType, ProColumns } from '@ant-design/pro-components';
import {
  Product,
  ProductShopListing,
  PriceSource,
  ShelfPriceMode,
  WB_LISTING_STATUS_TEXT,
  canShowOffShelfAction,
  canShowOnShelfAction,
  canUnlistListing,
  fetchProducts,
  isWbListingBusy,
  linkShelfPriceFields,
  previewShelfPrice,
  shelfProduct,
  shelfProductsBatch,
} from '../../../services/product';
import { Shop, fetchShopOptions } from '../../../services/shop';
import { ProductPreviewDrawer } from '../ProductPreview';
import { PackageGapBanner, PackageGapTags, PACKAGE_GAP_STYLE } from '../PackageGapNotice';
import { inspectProductPackage, productHasPackageGap } from '../../../services/package-dims';
import { useAuth } from '../../../auth';

function listingColor(status?: Product['wbListingStatus']) {
  if (status === 'LISTED') return 'green';
  if (status === 'FAILED') return 'red';
  if (status === 'QUEUED' || status === 'PROCESSING') return 'blue';
  return 'default';
}

function listingOf(product: Product, shopId: string): ProductShopListing | undefined {
  return product.shopListings?.find((item) => item.shopId === shopId);
}

const PRICE_SOURCE_OPTIONS: Array<{ label: string; value: PriceSource }> = [
  { label: '采集原价', value: 'original' },
  { label: '采集优惠价', value: 'discount' },
  { label: '采集实际销售价', value: 'sale' },
];

function crawledPriceHint(product?: Product | null): string {
  if (!product) {
    return '';
  }
  return `采集价：原价 ${product.originalPrice || '-'} / 优惠价 ${product.discountPrice || '-'} / 实际价 ${product.price}`;
}

type ShelfTarget =
  | { mode: 'single'; product: Product; onShelf: boolean }
  | { mode: 'batch'; products: Product[]; onShelf: true };

export default function ProductCatalogPage() {
  const actionRef = useRef<ActionType>();
  const { hasPermission } = useAuth();
  const [preview, setPreview] = useState<Product | null>(null);
  const [shops, setShops] = useState<Shop[]>([]);
  const [selectedRowKeys, setSelectedRowKeys] = useState<string[]>([]);
  const [selectedRows, setSelectedRows] = useState<Product[]>([]);
  const [shelfTarget, setShelfTarget] = useState<ShelfTarget | null>(null);
  const [selectedShopIds, setSelectedShopIds] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [priceMode, setPriceMode] = useState<ShelfPriceMode>('from_sources');
  const [priceMultiplier, setPriceMultiplier] = useState(1.2);
  const [saleMultiplier, setSaleMultiplier] = useState(1.2);
  const [listSource, setListSource] = useState<PriceSource>('original');
  const [saleSource, setSaleSource] = useState<PriceSource>('sale');
  const [fixedListPrice, setFixedListPrice] = useState<number>();
  const [fixedSalePrice, setFixedSalePrice] = useState<number>();
  const [fixedDiscountPercent, setFixedDiscountPercent] = useState<number>(20);
  const [manualListPrice, setManualListPrice] = useState<number>();
  const [manualSalePrice, setManualSalePrice] = useState<number>();
  const [manualDiscount, setManualDiscount] = useState<number>(0);
  const [manualStock, setManualStock] = useState<number>();

  useEffect(() => {
    fetchShopOptions('WILDBERRIES')
      .then(setShops)
      .catch((error: Error) => message.error(error.message));
  }, []);

  const sampleProduct = shelfTarget?.mode === 'single' ? shelfTarget.product : shelfTarget?.products[0];
  const listingPackageGaps = useMemo(() => {
    if (!shelfTarget?.onShelf) {
      return [];
    }
    const products = shelfTarget.mode === 'batch' ? shelfTarget.products : [shelfTarget.product];
    return products.map((item) => ({ product: item, gaps: inspectProductPackage(item) })).filter((item) => item.gaps.missingSize || item.gaps.missingWeight);
  }, [shelfTarget]);
  const pickerShops = useMemo(() => {
    if (!shelfTarget) {
      return [];
    }
    if (shelfTarget.onShelf) {
      return shops;
    }
    const listedIds = new Set(
      (shelfTarget.mode === 'single' ? shelfTarget.product.shopListings || [] : [])
        .filter(canUnlistListing)
        .map((item) => item.shopId),
    );
    return shops.filter((shop) => listedIds.has(shop.id));
  }, [shelfTarget, shops]);

  const previewPriced = useMemo(() => {
    if (!sampleProduct || !shelfTarget?.onShelf) {
      return null;
    }
    if (shelfTarget.mode === 'single') {
      return previewShelfPrice({
        price: Number(sampleProduct.price),
        originalPrice: sampleProduct.originalPrice == null ? null : Number(sampleProduct.originalPrice),
        discountPrice: sampleProduct.discountPrice == null ? null : Number(sampleProduct.discountPrice),
        mode: 'keep',
        listPrice: manualListPrice,
        salePrice: manualSalePrice,
        discountPercent: manualDiscount,
      });
    }
    return previewShelfPrice({
      price: Number(sampleProduct.price),
      originalPrice: sampleProduct.originalPrice == null ? null : Number(sampleProduct.originalPrice),
      discountPrice: sampleProduct.discountPrice == null ? null : Number(sampleProduct.discountPrice),
      mode: priceMode,
      multiplier: priceMultiplier,
      saleMultiplier,
      listSource,
      saleSource,
      fixedListPrice,
      fixedSalePrice,
      fixedDiscountPercent,
    });
  }, [
    fixedDiscountPercent,
    fixedListPrice,
    fixedSalePrice,
    listSource,
    manualDiscount,
    manualListPrice,
    manualSalePrice,
    priceMode,
    priceMultiplier,
    saleMultiplier,
    saleSource,
    sampleProduct,
    shelfTarget,
  ]);

  function applyManualLink(edited: 'list' | 'sale' | 'discount', next: Partial<{ list: number; sale: number; discount: number }>) {
    const linked = linkShelfPriceFields(edited, {
      listPrice: next.list ?? manualListPrice ?? 1,
      salePrice: next.sale ?? manualSalePrice ?? 1,
      discountPercent: next.discount ?? manualDiscount ?? 0,
    });
    setManualListPrice(linked.listPrice);
    setManualSalePrice(linked.salePrice);
    setManualDiscount(linked.discount);
  }

  function openShelf(product: Product, onShelf: boolean) {
    setSelectedShopIds(
      onShelf
        ? shops.map((shop) => shop.id)
        : (product.shopListings || []).filter(canUnlistListing).map((item) => item.shopId),
    );
    setPriceMode('keep');
    setPriceMultiplier(1.2);
    setSaleMultiplier(1.2);
    setListSource('original');
    setSaleSource('sale');
    setFixedListPrice(undefined);
    setFixedSalePrice(undefined);
    setFixedDiscountPercent(20);
    const sale = Math.max(1, Math.round(Number(product.price) || 1));
    const list = Math.max(sale, Math.round(Number(product.originalPrice) || sale));
    const linked = linkShelfPriceFields('sale', { listPrice: list, salePrice: sale, discountPercent: 0 });
    setManualListPrice(linked.listPrice);
    setManualSalePrice(linked.salePrice);
    setManualDiscount(linked.discount);
    setManualStock(product.stock);
    setShelfTarget({ mode: 'single', product, onShelf });
  }

  function openBatchShelf() {
    const eligible = selectedRows.filter(canShowOnShelfAction);
    if (!eligible.length) {
      message.warning('请先勾选已通过/已上架/已下架的商品');
      return;
    }
    setSelectedShopIds(shops.map((shop) => shop.id));
    setPriceMode('from_sources');
    setPriceMultiplier(1.2);
    setSaleMultiplier(1.2);
    setListSource('original');
    setSaleSource('sale');
    setFixedListPrice(undefined);
    setFixedSalePrice(undefined);
    setFixedDiscountPercent(20);
    setManualListPrice(undefined);
    setManualSalePrice(undefined);
    setManualDiscount(0);
    setManualStock(undefined);
    setShelfTarget({ mode: 'batch', products: eligible, onShelf: true });
  }

  const columns: ProColumns<Product>[] = [
    {
      title: '图片',
      search: false,
      width: 72,
      render: (_, row) =>
        row.mainImageUrl || row.imageUrls?.[0] ? (
          <Image src={row.mainImageUrl || row.imageUrls?.[0]} width={48} height={48} style={{ objectFit: 'cover' }} />
        ) : (
          '-'
        ),
    },
    { title: 'Ozon SKU', dataIndex: 'skuId', search: false, copyable: true, ellipsis: true },
    {
      title: 'WB 货号',
      dataIndex: 'wbVendorCode',
      search: false,
      render: (_, row) => row.wbVendorCode || row.skuId,
    },
    { title: '名称', dataIndex: 'name', search: false, ellipsis: true },
    {
      title: '品牌',
      dataIndex: 'brand',
      search: false,
      width: 120,
      ellipsis: true,
      render: (_, row) => row.brand || '-',
    },
    {
      title: '类目',
      dataIndex: 'categoryPath',
      ellipsis: true,
      width: 180,
      fieldProps: { placeholder: '类目关键词' },
    },
    { title: '实际价', dataIndex: 'price', search: false, width: 90 },
    {
      title: '优惠价',
      dataIndex: 'discountPrice',
      search: false,
      width: 90,
      render: (_, row) => row.discountPrice || '-',
    },
    {
      title: '原价',
      dataIndex: 'originalPrice',
      search: false,
      width: 90,
      render: (_, row) => row.originalPrice || '-',
    },
    { title: '库存', dataIndex: 'stock', search: false },
    {
      title: '尺寸/重量',
      dataIndex: 'packageDims',
      search: false,
      width: 140,
      render: (_, row) => <PackageGapTags gaps={inspectProductPackage(row)} />,
    },
    {
      title: '状态',
      dataIndex: 'status',
      valueType: 'select',
      valueEnum: {
        APPROVED: { text: '已通过' },
        ON_SHELF: { text: '已上架' },
        OFF_SHELF: { text: '已下架' },
      },
    },
    {
      title: '上架状态',
      dataIndex: 'wbListingStatus',
      valueType: 'select',
      hideInTable: true,
      valueEnum: {
        NONE: { text: '未上架' },
        QUEUED: { text: '排队中' },
        PROCESSING: { text: '建卡中' },
        LISTED: { text: '已建卡' },
        FAILED: { text: '上架失败' },
        UNLISTED: { text: '已回收' },
      },
    },
    {
      title: '店铺',
      dataIndex: 'shopId',
      hideInTable: true,
      valueType: 'select',
      fieldProps: {
        allowClear: true,
        options: shops.map((shop) => ({ label: shop.name, value: shop.id })),
        placeholder: '按店铺筛选',
      },
    },
    {
      title: '关键词',
      dataIndex: 'keyword',
      hideInTable: true,
      fieldProps: { placeholder: '名称 / Ozon SKU / WB 货号' },
    },
    {
      title: '店铺上架',
      dataIndex: 'shopListings',
      search: false,
      width: 220,
      render: (_, row) => {
        const listings = row.shopListings || [];
        if (!listings.length) {
          const status = row.wbListingStatus || 'NONE';
          return <Tag color={listingColor(status)}>{WB_LISTING_STATUS_TEXT[status] || status}</Tag>;
        }
        return (
          <div>
            {listings.map((item) => {
              const tag = (
                <Tag key={item.id} color={listingColor(item.status)}>
                  {item.shop?.name || item.shopId} · {WB_LISTING_STATUS_TEXT[item.status] || item.status}
                  {item.wbNmId ? ` · ${item.wbNmId}` : ''}
                </Tag>
              );
              return item.error ? (
                <Tooltip key={item.id} title={item.error}>
                  {tag}
                </Tooltip>
              ) : (
                tag
              );
            })}
          </div>
        );
      },
    },
    {
      title: '操作',
      valueType: 'option',
      render: (_, row) => {
        return [
          <a key="view" onClick={() => setPreview(row)}>
            详情
          </a>,
          ...(hasPermission('product:shelf') && canShowOnShelfAction(row)
            ? [
                <Button
                  key="on"
                  type="link"
                  style={productHasPackageGap(row) ? { ...PACKAGE_GAP_STYLE, padding: 0, height: 'auto' } : undefined}
                  onClick={() => openShelf(row, true)}
                >
                  上架
                </Button>,
              ]
            : []),
          ...(hasPermission('product:shelf') && canShowOffShelfAction(row)
            ? [
                <Button key="off" type="link" onClick={() => openShelf(row, false)}>
                  下架
                </Button>,
              ]
            : []),
        ];
      },
    },
  ];

  return (
    <PageContainer>
      <Typography.Paragraph type="secondary">
        上架会按采集到的原价 / 优惠价 / 实际销售价计算 WB 划线价与折后价。无尺码类目不会写入 Размер。品牌优先用店铺配置，
        否则用采集品牌或 NoName，是否通过由 WB 判定。Token 需含 Marketplace 权限。
      </Typography.Paragraph>
      <ProTable<Product>
        rowKey="id"
        actionRef={actionRef}
        columns={columns}
        headerTitle="商品库"
        search={{ labelWidth: 'auto', defaultCollapsed: false }}
        rowSelection={
          hasPermission('product:shelf')
            ? {
                selectedRowKeys,
                onChange: (keys, rows) => {
                  setSelectedRowKeys(keys as string[]);
                  setSelectedRows(rows);
                },
                getCheckboxProps: (row) => ({ disabled: !canShowOnShelfAction(row) }),
              }
            : undefined
        }
        toolBarRender={() =>
          hasPermission('product:shelf')
            ? [
                <Button key="batch" type="primary" disabled={!selectedRowKeys.length} onClick={openBatchShelf}>
                  批量上架（{selectedRowKeys.length}）
                </Button>,
              ]
            : []
        }
        request={async (params) => {
          const data = await fetchProducts({
            current: params.current,
            pageSize: params.pageSize,
            keyword: (params.keyword as string) || undefined,
            status: (params.status as string) || undefined,
            wbListingStatus: (params.wbListingStatus as string) || undefined,
            categoryPath: (params.categoryPath as string) || undefined,
            shopId: (params.shopId as string) || undefined,
            catalogOnly: params.status ? false : true,
          });
          return { data: data.list, total: data.total, success: true };
        }}
      />
      <ProductPreviewDrawer product={preview} onClose={() => setPreview(null)} />
      <Modal
        title={
          shelfTarget?.onShelf
            ? shelfTarget.mode === 'batch'
              ? `批量上架（${shelfTarget.products.length} 件）`
              : '上架到店铺'
            : '选择下架店铺'
        }
        open={Boolean(shelfTarget)}
        confirmLoading={submitting}
        okButtonProps={{
          disabled: !selectedShopIds.length,
          danger: Boolean(shelfTarget?.onShelf && listingPackageGaps.length),
        }}
        width={720}
        onCancel={() => {
          setShelfTarget(null);
          setSelectedShopIds([]);
        }}
        onOk={async () => {
          if (!shelfTarget || !selectedShopIds.length) {
            message.warning('请选择店铺');
            return;
          }
          setSubmitting(true);
          try {
            if (shelfTarget.mode === 'batch') {
              await shelfProductsBatch(
                shelfTarget.products.map((item) => item.id),
                {
                  onShelf: true,
                  shopIds: selectedShopIds,
                  stock: manualStock,
                  priceMode,
                  priceMultiplier,
                  saleMultiplier,
                  listSource,
                  saleSource,
                  fixedListPrice,
                  fixedSalePrice,
                  fixedDiscountPercent,
                },
              );
              message.success(`已提交 ${shelfTarget.products.length} 件上架任务`);
              setSelectedRowKeys([]);
              setSelectedRows([]);
            } else {
              const result = await shelfProduct(shelfTarget.product.id, {
                onShelf: shelfTarget.onShelf,
                shopIds: selectedShopIds,
                listPrice: shelfTarget.onShelf ? manualListPrice : undefined,
                salePrice: shelfTarget.onShelf ? manualSalePrice : undefined,
                discountPercent: shelfTarget.onShelf ? manualDiscount : undefined,
                stock: shelfTarget.onShelf ? manualStock : undefined,
              });
              if (shelfTarget.onShelf) {
                const queued = (result.shopListings || []).some((item) => isWbListingBusy(item.status));
                message.success(queued ? '已提交建卡任务，稍后刷新查看价格/库存同步结果' : '已提交上架');
              } else {
                message.success('已提交下架');
              }
            }
            setShelfTarget(null);
            setSelectedShopIds([]);
            actionRef.current?.reload();
          } catch (error) {
            message.error(error instanceof Error ? error.message : '操作失败');
          } finally {
            setSubmitting(false);
          }
        }}
      >
        {pickerShops.length ? (
          <>
            {listingPackageGaps.length ? (
              <PackageGapBanner
                listing
                gaps={{
                  dimensions: {},
                  missingSize: listingPackageGaps.some((item) => item.gaps.missingSize),
                  missingWeight: listingPackageGaps.some((item) => item.gaps.missingWeight),
                }}
              />
            ) : null}
            <Checkbox.Group
              style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}
              value={selectedShopIds}
              onChange={(values) => setSelectedShopIds(values as string[])}
              options={pickerShops.map((shop) => {
                const listing =
                  shelfTarget?.mode === 'single' ? listingOf(shelfTarget.product, shop.id) : undefined;
                const busy = isWbListingBusy(listing?.status);
                const listed = listing?.status === 'LISTED';
                return {
                  label: `${shop.name}${listed ? '（已上架）' : ''}${busy ? '（处理中）' : ''}${
                    listing?.wbNmId ? ` nmID ${listing.wbNmId}` : ''
                  }`,
                  value: shop.id,
                  disabled: isWbListingBusy(listing?.status),
                };
              })}
            />
            {shelfTarget?.onShelf ? (
              <Form layout="vertical">
                {shelfTarget.mode === 'single' ? (
                  <>
                    <Form.Item label="采集价">
                      <Typography.Text type="secondary">{crawledPriceHint(sampleProduct)}</Typography.Text>
                    </Form.Item>
                    <Form.Item label="原价 / 划线价（RUB）" extra="写入 WB price">
                      <InputNumber
                        style={{ width: '100%' }}
                        min={1}
                        value={manualListPrice}
                        onChange={(value) =>
                          applyManualLink('list', { list: value == null ? undefined : Number(value) })
                        }
                      />
                    </Form.Item>
                    <Form.Item label="折后价（RUB）" extra="改折后价会反算折扣%">
                      <InputNumber
                        style={{ width: '100%' }}
                        min={1}
                        value={manualSalePrice}
                        onChange={(value) =>
                          applyManualLink('sale', { sale: value == null ? undefined : Number(value) })
                        }
                      />
                    </Form.Item>
                    <Form.Item label="卖家折扣 %" extra="写入 WB discount；改原价或折扣%会重算折后价">
                      <InputNumber
                        style={{ width: '100%' }}
                        min={0}
                        max={99}
                        value={manualDiscount}
                        onChange={(value) =>
                          applyManualLink('discount', { discount: value == null ? 0 : Number(value) })
                        }
                      />
                    </Form.Item>
                    <Form.Item label="上架库存">
                      <InputNumber
                        style={{ width: '100%' }}
                        min={0}
                        value={manualStock}
                        onChange={(value) => setManualStock(value == null ? undefined : Number(value))}
                      />
                    </Form.Item>
                  </>
                ) : (
                  <>
                    <Form.Item label="价格策略">
                      <Radio.Group value={priceMode} onChange={(event) => setPriceMode(event.target.value)}>
                        <Space direction="vertical">
                          <Radio value="keep">保持采集价（划线=原价，折后=实际销售价）</Radio>
                          <Radio value="from_sources">按采集价分别计算（推荐）</Radio>
                          <Radio value="fixed_list_discount">覆盖：统一划线价 + 统一折扣%</Radio>
                          <Radio value="fixed_list_sale">覆盖：统一划线价 + 统一折后价</Radio>
                          <Radio value="fixed_sale_discount">覆盖：统一折后价 + 固定折扣%</Radio>
                        </Space>
                      </Radio.Group>
                    </Form.Item>
                    {priceMode === 'from_sources' && (
                      <>
                        <Form.Item label="划线价" extra={crawledPriceHint(sampleProduct)}>
                          <Space.Compact style={{ width: '100%' }}>
                            <Select
                              style={{ width: '55%' }}
                              value={listSource}
                              options={PRICE_SOURCE_OPTIONS}
                              onChange={(value) => setListSource(value)}
                            />
                            <InputNumber
                              style={{ width: '45%' }}
                              min={0.01}
                              step={0.1}
                              addonBefore="×"
                              value={priceMultiplier}
                              onChange={(value) => setPriceMultiplier(Number(value) || 1)}
                            />
                          </Space.Compact>
                        </Form.Item>
                        <Form.Item label="折后价">
                          <Space.Compact style={{ width: '100%' }}>
                            <Select
                              style={{ width: '55%' }}
                              value={saleSource}
                              options={PRICE_SOURCE_OPTIONS}
                              onChange={(value) => setSaleSource(value)}
                            />
                            <InputNumber
                              style={{ width: '45%' }}
                              min={0.01}
                              step={0.1}
                              addonBefore="×"
                              value={saleMultiplier}
                              onChange={(value) => setSaleMultiplier(Number(value) || 1)}
                            />
                          </Space.Compact>
                        </Form.Item>
                      </>
                    )}
                    {(priceMode === 'fixed_list_discount' || priceMode === 'fixed_list_sale') && (
                      <Form.Item label="统一原价（RUB）">
                        <InputNumber
                          style={{ width: '100%' }}
                          min={1}
                          value={fixedListPrice}
                          onChange={(value) => setFixedListPrice(value == null ? undefined : Number(value))}
                        />
                      </Form.Item>
                    )}
                    {(priceMode === 'fixed_list_sale' || priceMode === 'fixed_sale_discount') && (
                      <Form.Item label="统一折后价（RUB）">
                        <InputNumber
                          style={{ width: '100%' }}
                          min={1}
                          value={fixedSalePrice}
                          onChange={(value) => setFixedSalePrice(value == null ? undefined : Number(value))}
                        />
                      </Form.Item>
                    )}
                    {(priceMode === 'fixed_list_discount' || priceMode === 'fixed_sale_discount') && (
                      <Form.Item label="统一折扣 %">
                        <InputNumber
                          style={{ width: '100%' }}
                          min={0}
                          max={99}
                          value={fixedDiscountPercent}
                          onChange={(value) => setFixedDiscountPercent(value == null ? 0 : Number(value))}
                        />
                      </Form.Item>
                    )}
                    <Form.Item label="统一库存（可选，留空则用各商品自身库存）">
                      <InputNumber
                        style={{ width: '100%' }}
                        min={0}
                        value={manualStock}
                        onChange={(value) => setManualStock(value == null ? undefined : Number(value))}
                      />
                    </Form.Item>
                  </>
                )}
                {previewPriced != null && sampleProduct ? (
                  <Typography.Paragraph type="secondary">
                  预览：首件 {sampleProduct.skuId} 原价 {previewPriced.listPrice} → 折后{' '}
                  {previewPriced.salePrice}（折扣 {previewPriced.discount}%）
                    {manualStock != null ? `，库存 ${manualStock}` : `，库存沿用商品值`}
                  </Typography.Paragraph>
                ) : null}
              </Form>
            ) : null}
          </>
        ) : (
          <Typography.Text type="secondary">
            {shelfTarget?.onShelf
              ? '没有可上架的 Wildberries 店铺。请先在店铺管理中启用店铺并保存 Token，操作员还需被分配店铺。'
              : '该商品在当前可访问店铺中没有可下架记录。'}
          </Typography.Text>
        )}
      </Modal>
    </PageContainer>
  );
}
