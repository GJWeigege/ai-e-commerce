import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Logger } from '@nestjs/common';
import { QUEUE_CRAWLER_PREPARE } from './queue.constants';
import { CrawlerService } from '../modules/crawler/crawler.service';

@Processor(QUEUE_CRAWLER_PREPARE)
export class CrawlerPrepareProcessor extends WorkerHost {
  private readonly logger = new Logger(CrawlerPrepareProcessor.name);

  constructor(private readonly crawlerService: CrawlerService) {
    super();
  }

  async process(job: Job<{ taskId: string; tenantId: string }>): Promise<void> {
    this.logger.log(`prepare task=${job.data.taskId}`);
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        this.crawlerService.prepareTask(job.data.taskId, job.data.tenantId),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            reject(
              new Error(
              '采集准备超时（45s）。请确认任务参数后重试，并由 Chrome 插件领取采集。',
              ),
            );
          }, 45_000);
        }),
      ]);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.crawlerService.failTask(job.data.taskId, job.data.tenantId, message);
      throw error;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}
