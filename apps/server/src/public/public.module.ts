import { Module } from '@nestjs/common';
import { PublicController } from './public.controller';
import { RedeemService } from './public.service';

@Module({
  controllers: [PublicController],
  providers: [RedeemService],
  exports: [RedeemService],
})
export class PublicModule {}
