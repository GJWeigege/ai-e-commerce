import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Logger } from '@nestjs/common';
import { QUEUE_AI_SELECTION } from './queue.constants';
import { ProductService } from '../modules/product/product.service';

@Processor(QUEUE_AI_SELECTION)
export class AiSelectionProcessor extends WorkerHost {
  private readonly logger = new Logger(AiSelectionProcessor.name);

  constructor(private readonly productService: ProductService) {
    super();
  }

  async process(job: Job<{ tenantId: string; snapshotId: string; productId: string; aiId: string }>): Promise<void> {
    this.logger.log(`ai select product=${job.data.productId}`);
    await this.productService.runAiSelection(job.data);
  }
}
