import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { AgentProductDto } from './agent-result.dto';

describe('AgentProductDto', () => {
  it('accepts a chrome collector payload that still includes blocked=false', async () => {
    const dto = plainToInstance(AgentProductDto, {
      skuId: '1085845200',
      name: 'Кофе в зернах Tasty Coffee Брауни, 1 кг',
      sourceUrl: 'https://www.ozon.ru/product/kofe-1085845200',
      price: 1290,
      stock: 1,
      currency: 'RUB',
      imageUrls: [],
      specs: [],
      salesCount: 0,
      blocked: false,
    });
    const errors = await validate(dto, { whitelist: true, forbidNonWhitelisted: true });
    expect(errors).toEqual([]);
  });
});
