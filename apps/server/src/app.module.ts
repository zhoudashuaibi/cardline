import { Module } from '@nestjs/common';
import { PrismaModule } from './prisma/prisma.module';
import { ConvertModule } from './convert/convert.module';
import { MailboxModule } from './mailbox/mailbox.module';
import { SettingsModule } from './settings/settings.module';
import { AuthModule } from './auth/auth.module';
import { AccountsModule } from './accounts/accounts.module';
import { PublicModule } from './public/public.module';
import { AdminModule } from './admin/admin.module';
import { SeedService } from './seed.service';

@Module({
  imports: [
    PrismaModule,
    ConvertModule,
    MailboxModule,
    SettingsModule,
    AuthModule,
    AccountsModule,
    PublicModule,
    AdminModule,
  ],
  providers: [SeedService],
})
export class AppModule {}
