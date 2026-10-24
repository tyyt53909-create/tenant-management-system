import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { BusinessClock } from './business-clock.service.js';

@Global()
@Module({
  imports: [ConfigModule],
  providers: [BusinessClock],
  exports: [BusinessClock],
})
export class BusinessClockModule {}
