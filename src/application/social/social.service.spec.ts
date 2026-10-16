import { ConfigService } from '@nestjs/config';
import { jest } from '@jest/globals';
import type { AuthenticatedDevice } from '../../domain/device/device-auth.types.js';
import { SocialConversationStatus } from '../../generated/prisma/enums.js';
import { PrismaService } from '../../infrastructure/database/prisma.service.js';
import { GeminiTextProvider } from '../../infrastructure/social/gemini-text.provider.js';
import { MetaGraphClient } from '../../infrastructure/social/meta-graph.client.js';
import { SocialTokenVault } from '../../infrastructure/social/social-token-vault.js';
import { SocialService } from './social.service.js';

describe('SocialService conversations', () => {
  it('keeps resolved conversations out of the active inbox', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const prisma = {
      socialConversation: { findMany },
    } as unknown as PrismaService;
    const service = new SocialService(
      prisma,
      {} as ConfigService,
      {} as SocialTokenVault,
      {} as MetaGraphClient,
      {} as GeminiTextProvider,
    );
    const device = {
      clientId: 'client-1',
      storeId: 'store-1',
    } as AuthenticatedDevice;

    await service.conversations(device);

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          connection: { clientId: 'client-1', storeId: 'store-1' },
          status: { not: SocialConversationStatus.RESOLVED },
        },
      }),
    );
  });
});
