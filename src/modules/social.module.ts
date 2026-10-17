import { Module } from '@nestjs/common';
import { SocialService } from '../application/social/social.service.js';
import { GeminiTextProvider } from '../infrastructure/social/gemini-text.provider.js';
import { MetaGraphClient } from '../infrastructure/social/meta-graph.client.js';
import { SocialTokenVault } from '../infrastructure/social/social-token-vault.js';
import { SocialEntitlementGuard } from '../presentation/http/social/social-entitlement.guard.js';
import {
  DeviceSocialController,
  MetaCallbackController,
} from '../presentation/http/social/social.controller.js';
import { DeviceSyncModule } from './device-sync.module.js';
import { StoreDatabaseModule } from './store-database.module.js';

@Module({
  imports: [DeviceSyncModule, StoreDatabaseModule],
  controllers: [DeviceSocialController, MetaCallbackController],
  providers: [
    SocialService,
    SocialTokenVault,
    MetaGraphClient,
    GeminiTextProvider,
    SocialEntitlementGuard,
  ],
})
export class SocialModule {}
