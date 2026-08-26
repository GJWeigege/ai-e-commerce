import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { QUEUE_CRAWLER_RETRY } from './queue.constants';
import { CrawlerService } from '../modules/crawler/crawler.service';

@Processor(QUEUE_CRAWLER_RETRY)
export class CrawlerRetryProcessor extends WorkerHost {
  constructor(private readonly crawlerService: CrawlerService) {
    super();
  }

  async process(job: Job<{ itemId: string; tenantId: string }>): Promise<void> {
    await this.crawlerService.releaseItemToAgent(job.data.itemId, job.data.tenantId);
  }
}
