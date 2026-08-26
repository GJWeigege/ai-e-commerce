import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

export class PageQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize: number = 20;
}

export type PageResult<T> = {
  list: T[];
  total: number;
  page: number;
  pageSize: number;
};

/** Query 字符串不会自动变成 number；交叉类型 DTO 也会跳过 ValidationPipe 转换 */
export function normalizePageQuery(query: { page?: number | string; pageSize?: number | string }): {
  page: number;
  pageSize: number;
} {
  const page = Math.max(1, Number(query.page) || 1);
  const rawSize = Number(query.pageSize);
  const pageSize = Math.min(100, Math.max(1, Number.isFinite(rawSize) && rawSize > 0 ? rawSize : 20));
  return { page, pageSize };
}
