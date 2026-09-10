import { Global, Module } from '@nestjs/common';
import { MailboxService } from './mailbox.service';
import { MailAnalyzerService } from './mail-analyzer.service';

@Global()
@Module({
  providers: [MailboxService, MailAnalyzerService],
  exports: [MailboxService, MailAnalyzerService],
})
export class MailboxModule {}
