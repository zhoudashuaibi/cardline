import { Global, Module } from '@nestjs/common';
import { ConvertService } from './convert.service';

@Global()
@Module({
  providers: [ConvertService],
  exports: [ConvertService],
})
export class ConvertModule {}
