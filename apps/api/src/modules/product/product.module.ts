import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ProductController } from './product.controller';
import { ProductService } from './product.service';
import { QUEUE_WB_LISTING } from '../../queues/queue.constants';
import { IamModule } from '../iam/iam.module';

@Module({
  imports: [IamModule, BullModule.registerQueue({ name: QUEUE_WB_LISTING })],
  controllers: [ProductController],
  providers: [ProductService],
  exports: [ProductService],
})
export class ProductModule {}
