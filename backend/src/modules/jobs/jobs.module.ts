import { Module } from '@nestjs/common';
import { JobsController } from './jobs.controller.js';
import { JobsQueueService } from './jobs-queue.service.js';

@Module({
  controllers: [JobsController],
  providers: [JobsQueueService],
  exports: [JobsQueueService],
})
export class JobsModule {}
