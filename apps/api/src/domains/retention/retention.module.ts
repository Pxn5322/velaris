/** Retention wiring (T5.02). PrismaModule is global. */

import { Module } from '@nestjs/common';
import { RetentionService } from './retention.service.js';

@Module({
  providers: [RetentionService],
  exports: [RetentionService],
})
export class RetentionModule {}
