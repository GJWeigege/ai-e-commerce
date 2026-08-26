import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { BullModule } from '@nestjs/bullmq';
import {
  QUEUE_AI_SELECTION,
  QUEUE_CRAWLER_PREPARE,
  QUEUE_CRAWLER_RETRY,
  QUEUE_WB_LISTING,
  redisConnectionFromUrl,
} from './queue.constants';
import { CrawlerPrepareProcessor } from './crawler-prepare.processor';
import { CrawlerRetryProcessor } from './crawler-retry.processor';
import { AiSelectionProcessor } from './ai-selection.processor';
import { WbListingProcessor } from './wb-listing.processor';
import { RedisListingLockStore } from './redis-listing-lock.store';
import { ShopListingLock } from './wb-listing-concurrency';
import { CrawlerModule } from '../modules/crawler/crawler.module';
import { ProductModule } from '../modules/product/product.module';

@Module({
  imports: [
    BullModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        connection: redisConnectionFromUrl(config.get<string>('REDIS_URL', 'redis://localhost:6380')),
      }),
    }),
    BullModule.registerQueue(
      { name: QUEUE_CRAWLER_PREPARE },
      { name: QUEUE_CRAWLER_RETRY },
      { name: QUEUE_AI_SELECTION },
      { name: QUEUE_WB_LISTING },
    ),
    CrawlerModule,
    ProductModule,
  ],
  providers: [
    RedisListingLockStore,
    {
      provide: ShopListingLock,
      useFactory: (store: RedisListingLockStore) => new ShopListingLock(store),
      inject: [RedisListingLockStore],
    },
    CrawlerPrepareProcessor,
    CrawlerRetryProcessor,
    AiSelectionProcessor,
    WbListingProcessor,
  ],
  exports: [BullModule],
})
export class QueueModule {}
