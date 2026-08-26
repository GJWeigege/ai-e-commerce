# WB 上架原价/折扣价设计

## 背景

Wildberries Prices API（`POST /api/v2/upload/task`）只接受：

- `price`：折扣前原价（划线价）
- `discount`：卖家折扣百分比

折后价 = `price × (1 - discount/100)`，不可单独传。当前系统 `discount` 恒为 0。

## 决策

采用「三字段联动 + 批量策略」：

- 单品：原价 / 折后价 / 折扣% 联动，提交以原价+折扣% 写入 WB
- 批量：策略算出原价与折后价后反算折扣%
- 本轮不做：尺码价、WB Club 折扣

## 批量策略

| mode | 原价 | 折后价 |
|------|------|--------|
| `keep` | `original \|\| sale` | `sale` |
| `dual_times` | `original×m` | `sale×m` |
| `fixed_list_discount` | 固定原价 | 原价×(1-d%) |
| `fixed_list_sale` | 固定原价 | 固定折后价 |
| `fixed_sale_discount` | 折后/(1-d%) | 固定折后价 |

## 落库

- 商品库 `price` 更新为本次折后价（便于列表展示）
- 不强制改写商品 `originalPrice`（Ozon 来源语义保留）
- 队列任务携带 `listPrice` + `discount` + `salePrice`（sale 用于草稿）
