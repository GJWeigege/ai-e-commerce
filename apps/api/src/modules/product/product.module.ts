import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ProductController } from './product.controller';
import { ProductService } from './product.service';
import { WbCategoryMappingController } from './wb-category-mapping.controller';
import { WbCategoryMappingService } from './wb-category-mapping.service';
import { WbListingAdapterFactory } from './wb-listing-adapter.factory';
import { QUEUE_WB_LISTING } from '../../queues/queue.constants';
import { IamModule } from '../iam/iam.module';

@Module({
  imports: [IamModule, BullModule.registerQueue({ name: QUEUE_WB_LISTING })],
  controllers: [ProductController, WbCategoryMappingController],
  providers: [ProductService, WbCategoryMappingService, WbListingAdapterFactory],
  exports: [ProductService],
})
export class ProductModule {}
