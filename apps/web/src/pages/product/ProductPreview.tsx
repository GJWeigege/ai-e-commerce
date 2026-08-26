import { Descriptions, Drawer, Image, Tag, Typography } from 'antd';
import { Product, productDescription, productSpecs, productVariants } from '../../services/product';

export function ProductPreviewDrawer({
  product,
  onClose,
}: {
  product: Product | null;
  onClose: () => void;
}) {
  const variants = product ? productVariants(product) : [];
  const images = product?.imageUrls?.length
    ? product.imageUrls
    : product?.mainImageUrl
      ? [product.mainImageUrl]
      : [];
  const specs = product ? productSpecs(product).filter((item) => item.name !== '商品描述') : [];
  const description = product ? productDescription(product) || product.description || '' : '';

  return (
    <Drawer title={product?.name} width={760} open={Boolean(product)} onClose={onClose} destroyOnClose>
      {product ? (
        <>
          <Typography.Paragraph type="secondary">
            {product.categoryPath || product.brand || 'Ozon 采集'} · SKU {product.skuId}
            {product.rating ? ` · ${product.rating} 分` : ''}
            {product.reviewCount ? ` · ${product.reviewCount} 评价` : ''}
          </Typography.Paragraph>
          {images.length ? (
            <Image.PreviewGroup>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>
                {images.map((src) => (
                  <Image key={src} src={src} width={110} height={110} style={{ objectFit: 'cover' }} />
                ))}
              </div>
            </Image.PreviewGroup>
          ) : (
            <Typography.Text type="secondary">暂无图集</Typography.Text>
          )}
          <Descriptions size="small" column={2} style={{ marginBottom: 16 }}>
            <Descriptions.Item label="实际销售价">
              {product.price} {product.currency || 'RUB'}
            </Descriptions.Item>
            <Descriptions.Item label="优惠价">{product.discountPrice || '-'}</Descriptions.Item>
            <Descriptions.Item label="划线原价">{product.originalPrice || '-'}</Descriptions.Item>
            <Descriptions.Item label="品牌">{product.brand || '-'}</Descriptions.Item>
            <Descriptions.Item label="库存">{product.stock}</Descriptions.Item>
            <Descriptions.Item label="图集">{images.length} 张</Descriptions.Item>
            <Descriptions.Item label="Ozon SKU">{product.skuId}</Descriptions.Item>
            <Descriptions.Item label="WB 货号">{product.wbVendorCode || product.skuId}</Descriptions.Item>
            <Descriptions.Item label="WB nmID">{product.wbNmId || '-'}</Descriptions.Item>
            <Descriptions.Item label="WB 类目">{product.wbSubjectName || product.wbSubjectId || '-'}</Descriptions.Item>
            <Descriptions.Item label="WB 上架">
              {product.wbListingStatus && product.wbListingStatus !== 'NONE' ? product.wbListingStatus : '-'}
            </Descriptions.Item>
          </Descriptions>
          {product.shopListings?.length ? (
            <div style={{ marginBottom: 16 }}>
              <Typography.Title level={5}>店铺上架记录</Typography.Title>
              {product.shopListings.map((item) => (
                <div key={item.id} style={{ marginBottom: 8 }}>
                  <Tag color={item.status === 'LISTED' ? 'green' : item.status === 'FAILED' ? 'red' : 'blue'}>
                    {item.shop?.name || item.shopId} · {item.status}
                    {item.wbNmId ? ` · nmID ${item.wbNmId}` : ''}
                    {item.wbVendorCode ? ` · ${item.wbVendorCode}` : ''}
                  </Tag>
                  {item.error ? (
                    <Typography.Text type="danger" style={{ display: 'block' }}>
                      {item.error}
                    </Typography.Text>
                  ) : null}
                </div>
              ))}
            </div>
          ) : null}
          {product.wbListingError && !product.shopListings?.length ? (
            <Typography.Paragraph type="danger">WB 上架：{product.wbListingError}</Typography.Paragraph>
          ) : null}
          {variants.map((variant) => (
            <div key={variant.name} style={{ marginBottom: 12 }}>
              <Typography.Text strong>{variant.name}</Typography.Text>
              <div style={{ marginTop: 6 }}>
                {variant.values.map((item) => (
                  <Tag
                    key={item.value}
                    color={item.skuId === product.skuId || item.selected ? 'blue' : undefined}
                    style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
                  >
                    {item.imageUrls?.[0] ? (
                      <img src={item.imageUrls[0]} alt={item.value} width={22} height={22} style={{ objectFit: 'cover', borderRadius: 11 }} />
                    ) : null}
                    {item.value}
                  </Tag>
                ))}
              </div>
            </div>
          ))}
          {specs.length ? (
            <Descriptions size="small" column={1} bordered style={{ marginBottom: 16 }} title="规格参数">
              {specs.map((item) => (
                <Descriptions.Item key={`${item.name}-${item.value}`} label={item.name}>
                  {item.value}
                </Descriptions.Item>
              ))}
            </Descriptions>
          ) : null}
          {description ? (
            <>
              <Typography.Title level={5}>商品描述</Typography.Title>
              <Typography.Paragraph>{description}</Typography.Paragraph>
            </>
          ) : null}
          <Typography.Paragraph>
            <a href={product.sourceUrl} target="_blank" rel="noreferrer">
              打开 Ozon 源页面
            </a>
          </Typography.Paragraph>
        </>
      ) : null}
    </Drawer>
  );
}
