import { ConfigService } from '@nestjs/config';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { jest } from '@jest/globals';
import type { AuthenticatedDevice } from '../../domain/device/device-auth.types.js';
import {
  SocialConnectionStatus,
  SocialConversationStatus,
  SocialQuoteStatus,
} from '../../generated/prisma/enums.js';
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

describe('SocialService Messenger webhooks', () => {
  const webhookEvent = {
    id: 'event-1',
    payload: {
      object: 'page',
      entry: [
        {
          id: 'page-1',
          messaging: [
            {
              sender: { id: 'psid-1' },
              recipient: { id: 'page-1' },
              timestamp: 1_797_000_000_000,
              message: { mid: 'message-1', text: 'Hello' },
            },
          ],
        },
      ],
    },
  };

  function webhookService(options?: {
    profileError?: Error;
    participantName?: string;
    participantPictureUrl?: string;
  }) {
    const updateConversation = jest.fn().mockResolvedValue({});
    const updateWebhook = jest.fn().mockResolvedValue({});
    const upsertMessage = jest.fn().mockResolvedValue({});
    const prisma = {
      socialWebhookEvent: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findUnique: jest.fn().mockResolvedValue(webhookEvent),
        update: updateWebhook,
      },
      socialConnection: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'connection-1',
          pageId: 'page-1',
          tokenCiphertext: 'encrypted-page-token',
        }),
      },
      socialMessage: {
        findUnique: jest.fn().mockResolvedValue(null),
        upsert: upsertMessage,
      },
      socialConversation: {
        upsert: jest.fn().mockResolvedValue({
          id: 'conversation-1',
          participantId: 'psid-1',
          participantName: options?.participantName ?? null,
          participantPictureUrl: options?.participantPictureUrl ?? null,
          assignedTo: null,
          automationMode: 'OFF',
        }),
        update: updateConversation,
      },
    } as unknown as PrismaService;
    const userProfile = options?.profileError
      ? jest.fn().mockRejectedValue(options.profileError)
      : jest.fn().mockResolvedValue({
          id: 'psid-1',
          name: 'Jamie Customer',
          pictureUrl: 'https://platform-lookaside.fbsbx.com/customer.jpg',
        });
    const meta = { userProfile } as unknown as MetaGraphClient;
    const vault = {
      decrypt: jest.fn().mockReturnValue('page-token'),
    } as unknown as SocialTokenVault;
    return {
      prisma,
      updateWebhook,
      upsertMessage,
      userProfile,
      updateConversation,
      service: new SocialService(
        prisma,
        {} as ConfigService,
        vault,
        meta,
        {} as GeminiTextProvider,
      ),
    };
  }

  async function processWebhook(service: SocialService) {
    await (
      service as unknown as {
        processWebhookEvent(id: string): Promise<void>;
      }
    ).processWebhookEvent('event-1');
  }

  it('stores the Messenger participant name returned by Meta', async () => {
    const { service, userProfile, updateConversation } = webhookService();

    await processWebhook(service);

    expect(userProfile).toHaveBeenCalledWith('psid-1', 'page-token');
    expect(updateConversation).toHaveBeenCalledWith({
      where: { id: 'conversation-1' },
      data: {
        participantName: 'Jamie Customer',
        participantPictureUrl:
          'https://platform-lookaside.fbsbx.com/customer.jpg',
      },
    });
  });

  it('continues processing when Meta does not expose the profile', async () => {
    const { service, updateWebhook, upsertMessage, updateConversation } =
      webhookService({
        profileError: new Error('Profile unavailable'),
      });

    await processWebhook(service);

    expect(updateConversation).not.toHaveBeenCalled();
    expect(upsertMessage).toHaveBeenCalled();
    expect(updateWebhook).toHaveBeenLastCalledWith({
      where: { id: 'event-1' },
      data: {
        status: 'PROCESSED',
        processedAt: expect.any(Date) as Date,
        processingStartedAt: null,
      },
    });
  });

  it('adds a picture to an existing named conversation', async () => {
    const { service, userProfile, updateConversation } = webhookService({
      participantName: 'Jamie Customer',
    });

    await processWebhook(service);

    expect(userProfile).toHaveBeenCalledWith('psid-1', 'page-token');
    expect(updateConversation).toHaveBeenCalledWith({
      where: { id: 'conversation-1' },
      data: {
        participantPictureUrl:
          'https://platform-lookaside.fbsbx.com/customer.jpg',
      },
    });
  });
});

describe('SocialService commerce safety', () => {
  const device = {
    id: '30000000-0000-4000-8000-000000000003',
    clientId: 'client-1',
    storeId: 'store-1',
  } as AuthenticatedDevice;

  it('allows only one till to claim a quote import', async () => {
    const quote = {
      id: 'quote-1',
      connectionId: 'connection-1',
      status: SocialQuoteStatus.READY_TO_IMPORT,
      customerLink: { id: 'link-1', unlinkedAt: null },
      lines: [],
    };
    const prisma = {
      socialQuote: {
        findFirst: jest.fn().mockResolvedValue(quote),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
    } as unknown as PrismaService;
    const service = new SocialService(
      prisma,
      {} as ConfigService,
      {} as SocialTokenVault,
      {} as MetaGraphClient,
      {} as GeminiTextProvider,
      {} as never,
    );

    await expect(
      service.claimCommerceImport(device, quote.id, 'cashier'),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('searches active POS customers from the first typed character', async () => {
    const findMany = jest.fn().mockResolvedValue([
      { id: 7, name: 'Carlos Santos', contact: '09171234567' },
    ]);
    const prisma = {
      socialConnection: {
        findFirst: jest.fn().mockResolvedValue({
          id: '10000000-0000-4000-8000-000000000001',
          clientId: 'client-1',
          storeId: 'store-1',
          status: SocialConnectionStatus.ACTIVE,
        }),
      },
    } as unknown as PrismaService;
    const stores = {
      withClient: jest.fn(async (_storeId: string, operation: (store: unknown) => Promise<unknown>) => ({
        snapshot: {
          id: 'snapshot-1',
          schemaVersion: 27,
          snapshotCreatedAt: new Date(),
          syncedAt: new Date(),
        },
        data: await operation({ customer: { findMany } }),
      })),
    };
    const service = new SocialService(
      prisma,
      { get: jest.fn().mockReturnValue('15') } as unknown as ConfigService,
      {} as SocialTokenVault,
      {} as MetaGraphClient,
      {} as GeminiTextProvider,
      stores as never,
    );

    const result = await service.commerceCustomers(
      device,
      '10000000-0000-4000-8000-000000000001',
      ' C ',
    );

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        take: 25,
        where: {
          AND: [
            {
              OR: [
                { name: { contains: 'C' } },
                { contact: { contains: 'C' } },
              ],
            },
            { OR: [{ status: null }, { status: { not: 'inactive' } }] },
          ],
        },
      }),
    );
    expect(result.customers).toEqual([
      expect.objectContaining({ id: 7, name: 'Carlos Santos' }),
    ]);
    expect(result.snapshot.stale).toBe(false);
  });

  it('rejects a campaign caption that changes a price fact', async () => {
    const prisma = {
      socialConnection: {
        findFirst: jest.fn().mockResolvedValue({
          id: '10000000-0000-4000-8000-000000000001',
          clientId: 'client-1',
          storeId: 'store-1',
          status: SocialConnectionStatus.ACTIVE,
        }),
      },
    } as unknown as PrismaService;
    const service = new SocialService(
      prisma,
      {} as ConfigService,
      {} as SocialTokenVault,
      {} as MetaGraphClient,
      {} as GeminiTextProvider,
      {} as never,
    );

    await expect(
      service.createCampaign(device, {
        connectionId: '10000000-0000-4000-8000-000000000001',
        name: 'Price campaign',
        goal: 'Increase inquiries',
        facts: { product_name: '11kg LPG', price: '₱1,900.00' },
        variants: ['Ask us about our 11kg LPG.'],
        selectedVariant: 0,
        actor: 'manager',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
