import { Processor, WorkerHost } from '@nestjs/bullmq';
import { DelayedError, Job } from 'bullmq';
import { Logger } from '@nestjs/common';
import { QUEUE_WB_LISTING } from './queue.constants';
import { ProductService, WbListingJob } from '../modules/product/product.service';
import {
  ShopListingLock,
  WB_LISTING_SHOP_LOCK_RETRY_MS,
  beginShopListing,
  wbListingConcurrencyFromEnv,
} from './wb-listing-concurrency';

@Processor(QUEUE_WB_LISTING, {
  concurrency: wbListingConcurrencyFromEnv(process.env.WB_LISTING_CONCURRENCY),
})
export class WbListingProcessor extends WorkerHost {
  private readonly logger = new Logger(WbListingProcessor.name);

  constructor(
    private readonly productService: ProductService,
    private readonly shopLock: ShopListingLock,
  ) {
    super();
  }

  async process(job: Job<WbListingJob>, token?: string): Promise<void> {
    this.logger.log(`wb list product=${job.data.productId} shop=${job.data.shopId}`);
    if (!job.data.shopId) {
      throw new Error('上架任务缺少店铺');
    }

    const owner = String(job.id);
    const decision = await beginShopListing(this.shopLock, job.data.shopId, owner);
    if (decision === 'delay') {
      this.logger.debug(`shop ${job.data.shopId} busy, delay listing job ${owner}`);
      await job.moveToDelayed(Date.now() + WB_LISTING_SHOP_LOCK_RETRY_MS, token);
      throw new DelayedError();
    }

    try {
      await this.productService.processWbListing(job.data);
    } finally {
      await this.shopLock.release(job.data.shopId, owner);
    }
  }
}
