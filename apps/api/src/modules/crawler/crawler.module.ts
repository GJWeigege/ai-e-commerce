import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { CrawlerController } from './crawler.controller';
import { CollectorGatewayController } from './collector-gateway.controller';
import { CrawlerService } from './crawler.service';
import { QUEUE_AI_SELECTION, QUEUE_CRAWLER_PREPARE, QUEUE_CRAWLER_RETRY } from '../../queues/queue.constants';

@Module({
  imports: [
    BullModule.registerQueue(
      { name: QUEUE_CRAWLER_PREPARE },
      { name: QUEUE_CRAWLER_RETRY },
      { name: QUEUE_AI_SELECTION },
    ),
  ],
  controllers: [CrawlerController, CollectorGatewayController],
  providers: [CrawlerService],
  exports: [CrawlerService],
})
export class CrawlerModule {}
