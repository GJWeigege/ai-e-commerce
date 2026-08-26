import 'reflect-metadata';
import { normalizePageQuery } from './page-query.dto';

describe('normalizePageQuery', () => {
  it('keeps numeric pagination', () => {
    expect(normalizePageQuery({ page: 2, pageSize: 20 })).toEqual({ page: 2, pageSize: 20 });
  });

  it('coerces query-string pagination used by Prisma take/skip', () => {
    expect(normalizePageQuery({ page: '1', pageSize: '20' })).toEqual({ page: 1, pageSize: 20 });
  });

  it('falls back to defaults for invalid values', () => {
    expect(normalizePageQuery({})).toEqual({ page: 1, pageSize: 20 });
    expect(normalizePageQuery({ page: '0', pageSize: '-5' })).toEqual({ page: 1, pageSize: 20 });
  });
});
