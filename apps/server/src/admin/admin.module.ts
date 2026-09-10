import { Module } from '@nestjs/common';
import {
  AdminSettingsController,
  CardsController,
  CreditTiersController,
  StatsController,
} from './admin.controller';
import { AccountsModule } from '../accounts/accounts.module';

@Module({
  imports: [AccountsModule],
  controllers: [CardsController, CreditTiersController, AdminSettingsController, StatsController],
})
export class AdminModule {}
