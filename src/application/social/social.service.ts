import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';
import type { AuthenticatedDevice } from '../../domain/device/device-auth.types.js';
import type { Prisma } from '../../generated/prisma/client.js';
import {
  SocialAutomationMode,
  SocialCampaignStatus,
  SocialConnectionStatus,
  SocialConversationStatus,
  SocialMessageDirection,
  SocialMessageSender,
  SocialOauthStatus,
  SocialPostStatus,
  SocialQuoteStatus,
} from '../../generated/prisma/enums.js';
import { PrismaService } from '../../infrastructure/database/prisma.service.js';
import { StorePrismaClientFactory } from '../../infrastructure/store-database/store-prisma-client.factory.js';
import { GeminiTextProvider } from '../../infrastructure/social/gemini-text.provider.js';
import {
  MetaGraphClient,
  type MetaPageCredential,
} from '../../infrastructure/social/meta-graph.client.js';
import { SocialTokenVault } from '../../infrastructure/social/social-token-vault.js';

interface MetaWebhookPayload {
  object?: string;
  entry?: Array<{
    id?: string;
    messaging?: Array<{
      sender?: { id?: string };
      recipient?: { id?: string };
      timestamp?: number;
      message?: {
        mid?: string;
        text?: string;
        is_echo?: boolean;
        attachments?: unknown[];
      };
    }>;
  }>;
}

@Injectable()
export class SocialService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SocialService.name);
  private scheduleTimer?: NodeJS.Timeout;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly vault: SocialTokenVault,
    private readonly meta: MetaGraphClient,
    private readonly ai: GeminiTextProvider,
    private readonly stores: StorePrismaClientFactory,
  ) {}

  onModuleInit(): void {
    this.scheduleTimer = setInterval(() => this.runScheduledWork(), 30_000);
    this.scheduleTimer.unref();
    this.runScheduledWork();
  }

  onModuleDestroy(): void {
    if (this.scheduleTimer) clearInterval(this.scheduleTimer);
  }

  async listConnections(device: AuthenticatedDevice) {
    const values = await this.prisma.socialConnection.findMany({
      where: { clientId: device.clientId, storeId: device.storeId },
      orderBy: { connectedAt: 'desc' },
    });
    return values.map((value) => this.publicConnection(value));
  }

  async startOAuth(device: AuthenticatedDevice, actor: string) {
    const state = randomBytes(32).toString('base64url');
    const attempt = await this.prisma.socialOauthAttempt.create({
      data: {
        clientId: device.clientId,
        storeId: device.storeId,
        deviceId: device.id,
        stateHash: this.hash(state),
        actor: this.actor(actor),
        expiresAt: new Date(Date.now() + 10 * 60_000),
      },
    });
    return {
      attemptId: attempt.id,
      authorizationUrl: this.meta.authorizationUrl(state),
      expiresAt: attempt.expiresAt,
    };
  }

  async completeOAuthCallback(input: {
    state?: string;
    code?: string;
    error?: string;
    errorDescription?: string;
  }): Promise<{ success: boolean; message: string }> {
    if (!input.state) {
      return {
        success: false,
        message: 'The Facebook connection state is missing.',
      };
    }
    const attempt = await this.prisma.socialOauthAttempt.findUnique({
      where: { stateHash: this.hash(input.state) },
    });
    if (!attempt || attempt.status !== SocialOauthStatus.PENDING) {
      return {
        success: false,
        message:
          'This Facebook connection request is invalid or has already been used.',
      };
    }
    if (attempt.expiresAt.getTime() <= Date.now()) {
      await this.prisma.socialOauthAttempt.update({
        where: { id: attempt.id },
        data: {
          status: SocialOauthStatus.EXPIRED,
          errorMessage: 'Connection request expired.',
        },
      });
      return {
        success: false,
        message:
          'This Facebook connection request expired. Start again from POSV2.',
      };
    }
    if (input.error || !input.code) {
      const message = (
        input.errorDescription ||
        input.error ||
        'Facebook authorization was cancelled.'
      ).slice(0, 500);
      await this.prisma.socialOauthAttempt.update({
        where: { id: attempt.id },
        data: { status: SocialOauthStatus.FAILED, errorMessage: message },
      });
      return { success: false, message };
    }

    try {
      const userToken = await this.meta.exchangeCode(input.code);
      const pages = await this.meta.listPages(userToken);
      if (!pages.length)
        throw new BadRequestException(
          'No manageable Facebook Pages were returned.',
        );
      if (pages.length === 1) {
        const credential = await this.meta.pageCredential(
          userToken,
          pages[0].id,
        );
        const connection = await this.saveConnection(attempt, credential);
        await this.prisma.socialOauthAttempt.update({
          where: { id: attempt.id },
          data: {
            status: SocialOauthStatus.COMPLETE,
            connectionId: connection.id,
            completedAt: new Date(),
          },
        });
        return {
          success: true,
          message: `${connection.pageName} is connected. Return to POSV2.`,
        };
      }
      await this.prisma.socialOauthAttempt.update({
        where: { id: attempt.id },
        data: {
          status: SocialOauthStatus.AWAITING_PAGE,
          userTokenCiphertext: this.vault.encrypt(userToken),
          pageCandidates: pages as unknown as Prisma.InputJsonValue,
        },
      });
      return {
        success: true,
        message: 'Authorization succeeded. Return to POSV2 and select a Page.',
      };
    } catch (error) {
      const message = this.errorMessage(error);
      await this.prisma.socialOauthAttempt.update({
        where: { id: attempt.id },
        data: { status: SocialOauthStatus.FAILED, errorMessage: message },
      });
      return { success: false, message };
    }
  }

  async oauthAttempt(device: AuthenticatedDevice, attemptId: string) {
    const attempt = await this.prisma.socialOauthAttempt.findFirst({
      where: { id: attemptId, deviceId: device.id, storeId: device.storeId },
    });
    if (!attempt)
      throw new NotFoundException('Facebook connection attempt not found.');
    if (
      attempt.expiresAt.getTime() <= Date.now() &&
      attempt.status !== SocialOauthStatus.COMPLETE &&
      attempt.status !== SocialOauthStatus.FAILED
    ) {
      await this.prisma.socialOauthAttempt.update({
        where: { id: attempt.id },
        data: { status: SocialOauthStatus.EXPIRED },
      });
      attempt.status = SocialOauthStatus.EXPIRED;
    }
    return {
      id: attempt.id,
      status: attempt.status,
      pageCandidates: attempt.pageCandidates,
      connectionId: attempt.connectionId,
      errorMessage: attempt.errorMessage,
      expiresAt: attempt.expiresAt,
    };
  }

  async selectOAuthPage(
    device: AuthenticatedDevice,
    attemptId: string,
    pageId: string,
  ) {
    const attempt = await this.prisma.socialOauthAttempt.findFirst({
      where: {
        id: attemptId,
        deviceId: device.id,
        storeId: device.storeId,
        status: SocialOauthStatus.AWAITING_PAGE,
      },
    });
    if (!attempt?.userTokenCiphertext) {
      throw new NotFoundException('Page selection is no longer available.');
    }
    const candidates = Array.isArray(attempt.pageCandidates)
      ? attempt.pageCandidates
      : [];
    const candidate = candidates.find(
      (item) => this.objectString(item, 'id') === pageId,
    );
    if (!candidate) {
      throw new BadRequestException(
        'Select a Page returned by this connection attempt.',
      );
    }
    const credential = await this.meta.pageCredential(
      this.vault.decrypt(attempt.userTokenCiphertext),
      pageId,
      this.objectStringArray(candidate, 'tasks'),
    );
    const connection = await this.saveConnection(attempt, credential);
    await this.prisma.socialOauthAttempt.update({
      where: { id: attempt.id },
      data: {
        status: SocialOauthStatus.COMPLETE,
        connectionId: connection.id,
        userTokenCiphertext: null,
        completedAt: new Date(),
      },
    });
    return this.publicConnection(connection);
  }

  async connectWithToken(
    device: AuthenticatedDevice,
    accessToken: string,
    actor: string,
  ) {
    const credential = await this.meta.inspectPageToken(accessToken.trim());
    const connection = await this.upsertConnection(
      device.clientId,
      device.storeId,
      this.actor(actor),
      credential,
    );
    return this.publicConnection(connection);
  }

  async checkConnection(device: AuthenticatedDevice, id: string) {
    const connection = await this.connection(device, id);
    try {
      const credential = await this.meta.inspectPageToken(
        this.vault.decrypt(connection.tokenCiphertext),
      );
      const updated = await this.prisma.socialConnection.update({
        where: { id: connection.id },
        data: {
          pageName: credential.name,
          status: SocialConnectionStatus.ACTIVE,
          grantedPermissions: credential.permissions,
          pageTasks: credential.tasks,
          lastCheckedAt: new Date(),
          lastError: null,
        },
      });
      return this.publicConnection(updated);
    } catch (error) {
      const updated = await this.prisma.socialConnection.update({
        where: { id: connection.id },
        data: {
          status: SocialConnectionStatus.ACTION_REQUIRED,
          lastCheckedAt: new Date(),
          lastError: this.errorMessage(error),
        },
      });
      return this.publicConnection(updated);
    }
  }

  async disconnect(device: AuthenticatedDevice, id: string) {
    const connection = await this.connection(device, id);
    await this.prisma.socialConnection.update({
      where: { id: connection.id },
      data: {
        status: SocialConnectionStatus.DISCONNECTED,
        disconnectedAt: new Date(),
        tokenCiphertext: this.vault.encrypt(
          `disconnected:${randomBytes(16).toString('hex')}`,
        ),
      },
    });
  }

  async templates(device: AuthenticatedDevice, connectionId?: string) {
    if (connectionId) await this.connection(device, connectionId);
    return this.prisma.socialPostTemplate.findMany({
      where: {
        connection: { clientId: device.clientId, storeId: device.storeId },
        ...(connectionId ? { connectionId } : {}),
      },
      orderBy: { name: 'asc' },
    });
  }

  async saveTemplate(
    device: AuthenticatedDevice,
    input: {
      id?: string;
      connectionId: string;
      name: string;
      body: string;
      autoPublish: boolean;
      actor: string;
    },
  ) {
    await this.connection(device, input.connectionId);
    if (input.id) {
      const existing = await this.prisma.socialPostTemplate.findFirst({
        where: { id: input.id, connectionId: input.connectionId },
      });
      if (!existing) throw new NotFoundException('Post template not found.');
      return this.prisma.socialPostTemplate.update({
        where: { id: existing.id },
        data: {
          name: input.name.trim(),
          body: input.body.trim(),
          autoPublish: input.autoPublish,
        },
      });
    }
    return this.prisma.socialPostTemplate.create({
      data: {
        connectionId: input.connectionId,
        name: input.name.trim(),
        body: input.body.trim(),
        autoPublish: input.autoPublish,
        createdBy: this.actor(input.actor),
      },
    });
  }

  async generatePost(
    device: AuthenticatedDevice,
    input: {
      connectionId: string;
      template: string;
      facts: Record<string, string>;
      tone: string;
      language: string;
    },
  ) {
    await this.connection(device, input.connectionId);
    const facts = Object.fromEntries(
      Object.entries(input.facts)
        .filter(
          ([key, value]) =>
            /^[a-z][a-z0-9_]{0,39}$/i.test(key) && typeof value === 'string',
        )
        .map(([key, value]) => [key, value.slice(0, 500)]),
    );
    return this.ai.generateCaptions({ ...input, facts });
  }

  async createPost(
    device: AuthenticatedDevice,
    input: {
      connectionId: string;
      templateId?: string;
      content: string;
      scheduledAt?: string;
      approvalRequired: boolean;
      idempotencyKey: string;
      actor: string;
    },
  ) {
    await this.connection(device, input.connectionId, true);
    const scheduledAt = input.scheduledAt ? new Date(input.scheduledAt) : null;
    const status = input.approvalRequired
      ? SocialPostStatus.AWAITING_APPROVAL
      : scheduledAt && scheduledAt.getTime() > Date.now()
        ? SocialPostStatus.SCHEDULED
        : SocialPostStatus.SCHEDULED;
    const post = await this.prisma.socialPost.create({
      data: {
        connectionId: input.connectionId,
        templateId: input.templateId,
        content: input.content.trim(),
        scheduledAt,
        status,
        idempotencyKey: input.idempotencyKey,
        createdBy: this.actor(input.actor),
        ...(!input.approvalRequired
          ? { approvedBy: this.actor(input.actor), approvedAt: new Date() }
          : {}),
      },
    });
    if (
      !input.approvalRequired &&
      (!scheduledAt || scheduledAt <= new Date())
    ) {
      return this.publishPost(post.id);
    }
    return post;
  }

  async posts(device: AuthenticatedDevice, connectionId?: string) {
    if (connectionId) await this.connection(device, connectionId);
    return this.prisma.socialPost.findMany({
      where: {
        connection: { clientId: device.clientId, storeId: device.storeId },
        ...(connectionId ? { connectionId } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }

  async approvePost(device: AuthenticatedDevice, id: string, actor: string) {
    const post = await this.post(device, id);
    if (post.status !== SocialPostStatus.AWAITING_APPROVAL) {
      throw new ConflictException(
        'Only posts awaiting approval can be approved.',
      );
    }
    await this.prisma.socialPost.update({
      where: { id },
      data: {
        status: SocialPostStatus.SCHEDULED,
        approvedBy: this.actor(actor),
        approvedAt: new Date(),
      },
    });
    if (!post.scheduledAt || post.scheduledAt <= new Date())
      return this.publishPost(id);
    return this.prisma.socialPost.findUniqueOrThrow({ where: { id } });
  }

  async cancelPost(device: AuthenticatedDevice, id: string) {
    const post = await this.post(device, id);
    if (
      post.status === SocialPostStatus.PUBLISHED ||
      post.status === SocialPostStatus.PUBLISHING
    ) {
      throw new ConflictException(
        'A publishing or published post cannot be cancelled.',
      );
    }
    return this.prisma.socialPost.update({
      where: { id },
      data: { status: SocialPostStatus.CANCELLED },
    });
  }

  async retryPost(device: AuthenticatedDevice, id: string) {
    const post = await this.post(device, id);
    if (post.status !== SocialPostStatus.FAILED) {
      throw new ConflictException('Only a failed post can be retried.');
    }
    await this.prisma.socialPost.update({
      where: { id },
      data: { status: SocialPostStatus.SCHEDULED, lastError: null },
    });
    return this.publishPost(id);
  }

  async heartbeat(
    device: AuthenticatedDevice,
    input: {
      connectionId: string;
      actor: string;
      displayName: string;
      availability: string;
    },
  ) {
    await this.connection(device, input.connectionId);
    return this.prisma.socialCashierPresence.upsert({
      where: {
        connectionId_deviceId_username: {
          connectionId: input.connectionId,
          deviceId: device.id,
          username: this.actor(input.actor),
        },
      },
      create: {
        connectionId: input.connectionId,
        deviceId: device.id,
        username: this.actor(input.actor),
        displayName: input.displayName.trim().slice(0, 160),
        availability: input.availability,
      },
      update: {
        displayName: input.displayName.trim().slice(0, 160),
        availability: input.availability,
        lastSeenAt: new Date(),
      },
    });
  }

  async conversations(device: AuthenticatedDevice, connectionId?: string) {
    if (connectionId) await this.connection(device, connectionId);
    const values = await this.prisma.socialConversation.findMany({
      where: {
        connection: { clientId: device.clientId, storeId: device.storeId },
        status: { not: SocialConversationStatus.RESOLVED },
        ...(connectionId ? { connectionId } : {}),
      },
      include: { messages: { orderBy: { sentAt: 'desc' }, take: 1 } },
      orderBy: { lastMessageAt: 'desc' },
      take: 100,
    });
    return values.map((value) => ({
      ...value,
      replyMode: this.replyMode(value.lastInboundAt),
    }));
  }

  async messages(device: AuthenticatedDevice, conversationId: string) {
    await this.conversation(device, conversationId);
    await this.prisma.socialConversation.update({
      where: { id: conversationId },
      data: { unreadCount: 0 },
    });
    return this.prisma.socialMessage.findMany({
      where: { conversationId },
      orderBy: { sentAt: 'asc' },
      take: 300,
    });
  }

  async claimConversation(
    device: AuthenticatedDevice,
    conversationId: string,
    actor: string,
  ) {
    const conversation = await this.conversation(device, conversationId);
    const username = this.actor(actor);
    const claimed = await this.prisma.socialConversation.updateMany({
      where: {
        id: conversation.id,
        OR: [{ assignedTo: null }, { assignedTo: username }],
      },
      data: {
        assignedTo: username,
        assignedAt: new Date(),
        status: SocialConversationStatus.ASSIGNED,
        automationMode: SocialAutomationMode.OFF,
      },
    });
    if (!claimed.count)
      throw new ConflictException(
        'Another cashier already claimed this conversation.',
      );
    return this.prisma.socialConversation.findUniqueOrThrow({
      where: { id: conversation.id },
    });
  }

  async releaseConversation(
    device: AuthenticatedDevice,
    conversationId: string,
    actor: string,
  ) {
    const conversation = await this.conversation(device, conversationId);
    const username = this.actor(actor);
    if (conversation.assignedTo && conversation.assignedTo !== username) {
      throw new ConflictException(
        `This conversation is assigned to ${conversation.assignedTo}.`,
      );
    }
    return this.prisma.socialConversation.update({
      where: { id: conversation.id },
      data: {
        assignedTo: null,
        assignedAt: null,
        status: SocialConversationStatus.WAITING,
      },
    });
  }

  async reply(
    device: AuthenticatedDevice,
    conversationId: string,
    text: string,
    actor: string,
  ) {
    const conversation = await this.conversation(device, conversationId);
    if (this.replyMode(conversation.lastInboundAt) !== 'OPEN_24H') {
      throw new ConflictException(
        'The standard Messenger reply window is closed.',
      );
    }
    const connection = await this.connection(
      device,
      conversation.connectionId,
      true,
    );
    const username = this.actor(actor);
    if (conversation.assignedTo && conversation.assignedTo !== username) {
      throw new ConflictException(
        `This conversation is assigned to ${conversation.assignedTo}.`,
      );
    }
    const providerMessageId = await this.meta.sendMessage(
      connection.pageId,
      this.vault.decrypt(connection.tokenCiphertext),
      conversation.participantId,
      text.trim(),
    );
    const sentAt = new Date();
    const message = await this.prisma.socialMessage.create({
      data: {
        connectionId: connection.id,
        conversationId: conversation.id,
        providerMessageId,
        direction: SocialMessageDirection.OUTBOUND,
        sender: SocialMessageSender.CASHIER,
        senderName: username,
        text: text.trim(),
        deliveryStatus: 'SENT',
        sentAt,
      },
    });
    await this.prisma.socialConversation.update({
      where: { id: conversation.id },
      data: {
        assignedTo: username,
        assignedAt: conversation.assignedAt ?? sentAt,
        status: SocialConversationStatus.ASSIGNED,
        automationMode: SocialAutomationMode.OFF,
        lastMessageAt: sentAt,
      },
    });
    return message;
  }

  async suggestReply(device: AuthenticatedDevice, conversationId: string) {
    const conversation = await this.conversation(device, conversationId);
    const recent = await this.prisma.socialMessage.findMany({
      where: { conversationId: conversation.id },
      orderBy: { sentAt: 'desc' },
      take: 4,
    });
    const latestCustomerText = recent.find(
      (item) => item.direction === SocialMessageDirection.INBOUND && item.text,
    )?.text;
    if (!latestCustomerText)
      return { variants: [], provider: 'TEMPLATE', fallback: true };
    const faqs = await this.prisma.socialFaq.findMany({
      where: { connectionId: conversation.connectionId, enabled: true },
      take: 20,
    });
    const matched = this.matchFaq(latestCustomerText, faqs);
    if (!matched) {
      return {
        variants: ['Thank you for your message. Let me check that for you.'],
        provider: 'TEMPLATE',
        fallback: true,
      };
    }
    return this.ai.generateCaptions({
      template: matched.answer,
      facts: {},
      tone: 'helpful customer service reply; do not add new facts',
      language: 'same language as the customer when clear, otherwise English',
    });
  }

  async resolveConversation(
    device: AuthenticatedDevice,
    conversationId: string,
    actor: string,
  ) {
    const conversation = await this.conversation(device, conversationId);
    if (
      conversation.assignedTo &&
      conversation.assignedTo !== this.actor(actor)
    ) {
      throw new ConflictException(
        `This conversation is assigned to ${conversation.assignedTo}.`,
      );
    }
    return this.prisma.socialConversation.update({
      where: { id: conversation.id },
      data: {
        status: SocialConversationStatus.RESOLVED,
        resolvedAt: new Date(),
        assignedTo: null,
        assignedAt: null,
      },
    });
  }

  async setAutomation(
    device: AuthenticatedDevice,
    conversationId: string,
    mode: keyof typeof SocialAutomationMode,
  ) {
    const conversation = await this.conversation(device, conversationId);
    return this.prisma.socialConversation.update({
      where: { id: conversation.id },
      data: { automationMode: SocialAutomationMode[mode] },
    });
  }

  async faqs(device: AuthenticatedDevice, connectionId?: string) {
    if (connectionId) await this.connection(device, connectionId);
    return this.prisma.socialFaq.findMany({
      where: {
        connection: { clientId: device.clientId, storeId: device.storeId },
        ...(connectionId ? { connectionId } : {}),
      },
      orderBy: { question: 'asc' },
    });
  }

  async saveFaq(
    device: AuthenticatedDevice,
    input: {
      id?: string;
      connectionId: string;
      question: string;
      answer: string;
      keywords: string[];
      enabled: boolean;
      actor: string;
    },
  ) {
    await this.connection(device, input.connectionId);
    const data = {
      question: input.question.trim(),
      answer: input.answer.trim(),
      keywords: input.keywords
        .map((item) => item.trim().toLowerCase())
        .filter(Boolean)
        .slice(0, 20),
      enabled: input.enabled,
    };
    if (input.id) {
      const existing = await this.prisma.socialFaq.findFirst({
        where: { id: input.id, connectionId: input.connectionId },
      });
      if (!existing) throw new NotFoundException('FAQ not found.');
      return this.prisma.socialFaq.update({ where: { id: existing.id }, data });
    }
    return this.prisma.socialFaq.create({
      data: {
        ...data,
        connectionId: input.connectionId,
        createdBy: this.actor(input.actor),
      },
    });
  }

  async commerceCatalog(
    device: AuthenticatedDevice,
    connectionId: string,
    query = '',
  ) {
    await this.connection(device, connectionId);
    const term = query.trim().slice(0, 120);
    const result = await this.stores.withClient(device.storeId, (store) =>
      store.inventoryItem.findMany({
        where: term
          ? {
              OR: [
                { code: { contains: term } },
                { name: { contains: term } },
                { brand: { contains: term } },
                { category: { contains: term } },
                { size: { contains: term } },
              ],
            }
          : undefined,
        include: { prices: true },
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
        take: 40,
      }),
    );
    const configuredMaxAge = Number(
      this.config.get<string>('SOCIAL_COMMERCE_MAX_SNAPSHOT_AGE_MINUTES') ?? 15,
    );
    const maxAgeMinutes = Number.isFinite(configuredMaxAge)
      ? Math.max(1, Math.min(24 * 60, configuredMaxAge))
      : 15;
    const ageMinutes = Math.max(
      0,
      Math.floor(
        (Date.now() - result.snapshot.snapshotCreatedAt.getTime()) / 60_000,
      ),
    );
    return {
      snapshot: {
        ...result.snapshot,
        ageMinutes,
        stale: ageMinutes > maxAgeMinutes,
        maxAgeMinutes,
      },
      items: result.data.map((item) => ({
        id: item.id,
        code: item.code?.trim() ?? '',
        name: item.name?.trim() ?? 'Unnamed product',
        brand: item.brand?.trim() ?? '',
        size: item.size?.trim() ?? '',
        category: item.category?.trim() ?? '',
        fillQuantity: item.fillQuantity ?? item.quantity ?? 0,
        alertLevel: item.alertLevel ?? 0,
        refillPriceMinor: this.moneyMinor(
          item.prices?.refill ?? item.sellingPrice ?? 0,
        ),
        nonRefillPriceMinor: this.moneyMinor(
          item.prices?.nonRefill ?? item.sellingPrice ?? 0,
        ),
      })),
    };
  }

  async commerceCustomers(
    device: AuthenticatedDevice,
    connectionId: string,
    query = '',
  ) {
    await this.connection(device, connectionId);
    const term = query.trim().slice(0, 120);
    if (!term) return { customers: [], snapshot: null };
    const result = await this.stores.withClient(device.storeId, (store) =>
      store.customer.findMany({
        where: {
          AND: [
            {
              OR: [
                { name: { contains: term } },
                { contact: { contains: term } },
              ],
            },
            { OR: [{ status: null }, { status: { not: 'inactive' } }] },
          ],
        },
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
        take: 25,
      }),
    );
    const configuredMaxAge = Number(
      this.config.get<string>('SOCIAL_COMMERCE_MAX_SNAPSHOT_AGE_MINUTES') ?? 15,
    );
    const maxAgeMinutes = Number.isFinite(configuredMaxAge)
      ? Math.max(1, Math.min(24 * 60, configuredMaxAge))
      : 15;
    const ageMinutes = Math.max(
      0,
      Math.floor(
        (Date.now() - result.snapshot.snapshotCreatedAt.getTime()) / 60_000,
      ),
    );
    return {
      snapshot: {
        ...result.snapshot,
        ageMinutes,
        stale: ageMinutes > maxAgeMinutes,
        maxAgeMinutes,
      },
      customers: result.data.map((customer) => ({
        id: customer.id,
        name: customer.name?.trim() ?? 'Unnamed customer',
        contact: customer.contact?.trim() ?? '',
        address: '',
        email: '',
      })),
    };
  }

  async commerceContext(device: AuthenticatedDevice, conversationId: string) {
    const conversation = await this.conversation(device, conversationId);
    const [customerLink, quotes] = await Promise.all([
      this.prisma.socialCustomerLink.findUnique({
        where: { conversationId },
      }),
      this.prisma.socialQuote.findMany({
        where: { conversationId },
        include: { lines: { orderBy: { createdAt: 'asc' } } },
        orderBy: { createdAt: 'desc' },
        take: 20,
      }),
    ]);
    return {
      connectionId: conversation.connectionId,
      customerLink:
        customerLink && !customerLink.unlinkedAt ? customerLink : null,
      quotes,
    };
  }

  async linkCommerceCustomer(
    device: AuthenticatedDevice,
    conversationId: string,
    input: {
      posCustomerId: number;
      customerName: string;
      customerContact?: string;
      actor: string;
    },
  ) {
    const conversation = await this.conversation(device, conversationId);
    const found = await this.stores.withClient(device.storeId, (store) =>
      store.customer.findUnique({ where: { id: input.posCustomerId } }),
    );
    if (!found.data) throw new NotFoundException('POS customer not found.');
    const actor = this.actor(input.actor);
    const link = await this.prisma.socialCustomerLink.upsert({
      where: { conversationId },
      create: {
        connectionId: conversation.connectionId,
        conversationId,
        posCustomerId: found.data.id,
        customerName: found.data.name?.trim() || input.customerName.trim(),
        customerContact:
          found.data.contact?.trim() || input.customerContact?.trim() || null,
        linkedBy: actor,
      },
      update: {
        posCustomerId: found.data.id,
        customerName: found.data.name?.trim() || input.customerName.trim(),
        customerContact:
          found.data.contact?.trim() || input.customerContact?.trim() || null,
        linkedBy: actor,
        linkedAt: new Date(),
        unlinkedAt: null,
      },
    });
    await this.commerceEvent(
      conversation.connectionId,
      null,
      'CUSTOMER_LINKED',
      actor,
      device.id,
      { posCustomerId: link.posCustomerId },
    );
    return link;
  }

  async unlinkCommerceCustomer(
    device: AuthenticatedDevice,
    conversationId: string,
    actorValue: string,
  ) {
    const conversation = await this.conversation(device, conversationId);
    const existing = await this.prisma.socialCustomerLink.findUnique({
      where: { conversationId },
    });
    if (!existing) return { unlinked: true };
    const actor = this.actor(actorValue);
    await this.prisma.socialCustomerLink.update({
      where: { id: existing.id },
      data: { unlinkedAt: new Date() },
    });
    await this.commerceEvent(
      conversation.connectionId,
      null,
      'CUSTOMER_UNLINKED',
      actor,
      device.id,
      { posCustomerId: existing.posCustomerId },
    );
    return { unlinked: true };
  }

  async saveCommerceQuote(
    device: AuthenticatedDevice,
    input: {
      id?: string;
      connectionId: string;
      conversationId: string;
      sourceCampaignId?: string;
      lines: Array<{
        posItemId: number;
        itemCode: string;
        itemName: string;
        itemSize: string;
        unit: 'REFILL' | 'NON-REFILL';
        quantity: number;
        unitPriceMinor: number;
        sourceSnapshotId?: string;
      }>;
      notes: string;
      expiresAt?: string;
      idempotencyKey: string;
      actor: string;
    },
  ) {
    await this.connection(device, input.connectionId);
    const conversation = await this.conversation(device, input.conversationId);
    if (conversation.connectionId !== input.connectionId) {
      throw new BadRequestException('Conversation and Page do not match.');
    }
    if (!input.lines.length) {
      throw new BadRequestException('Add at least one quote item.');
    }
    const duplicate = await this.prisma.socialQuote.findUnique({
      where: { idempotencyKey: input.idempotencyKey },
      include: { lines: true },
    });
    if (duplicate) return duplicate;

    const requestedIds = [
      ...new Set(input.lines.map((line) => line.posItemId)),
    ];
    const catalog = await this.stores.withClient(device.storeId, (store) =>
      store.inventoryItem.findMany({
        where: { id: { in: requestedIds } },
        include: { prices: true },
      }),
    );
    const products = new Map(catalog.data.map((item) => [item.id, item]));
    const lines = input.lines.map((line) => {
      const product = products.get(line.posItemId);
      if (!product) {
        throw new BadRequestException(
          `Product ${line.itemName || line.posItemId} is no longer available.`,
        );
      }
      const price = this.moneyMinor(
        line.unit === 'REFILL'
          ? (product.prices?.refill ?? product.sellingPrice ?? 0)
          : (product.prices?.nonRefill ?? product.sellingPrice ?? 0),
      );
      return {
        posItemId: product.id,
        itemCode: product.code?.trim() || line.itemCode.trim(),
        itemName: product.name?.trim() || line.itemName.trim(),
        itemSize: product.size?.trim() || line.itemSize.trim(),
        unit: line.unit,
        quantity: line.quantity,
        unitPriceMinor: price,
        lineTotalMinor: price * line.quantity,
        sourceSnapshotId: catalog.snapshot.id,
      };
    });
    const subtotalMinor = lines.reduce(
      (sum, line) => sum + line.lineTotalMinor,
      0,
    );
    if (!Number.isSafeInteger(subtotalMinor) || subtotalMinor > 100_000_000) {
      throw new BadRequestException(
        'Quote total is outside the allowed range.',
      );
    }
    const customerLink = await this.prisma.socialCustomerLink.findFirst({
      where: { conversationId: input.conversationId, unlinkedAt: null },
    });
    if (input.sourceCampaignId) {
      const campaign = await this.prisma.socialCampaign.findFirst({
        where: {
          id: input.sourceCampaignId,
          connectionId: input.connectionId,
        },
      });
      if (!campaign) throw new NotFoundException('Campaign not found.');
    }
    const actor = this.actor(input.actor);
    const expiresAt = input.expiresAt
      ? new Date(input.expiresAt)
      : new Date(Date.now() + 24 * 60 * 60_000);
    const quote = await this.prisma.$transaction(async (transaction) => {
      if (input.id) {
        const existing = await transaction.socialQuote.findFirst({
          where: {
            id: input.id,
            connectionId: input.connectionId,
            conversationId: input.conversationId,
          },
        });
        if (!existing) throw new NotFoundException('Quote not found.');
        if (existing.status !== SocialQuoteStatus.DRAFT) {
          throw new ConflictException('Only draft quotes can be edited.');
        }
        await transaction.socialQuoteLine.deleteMany({
          where: { quoteId: existing.id },
        });
        return transaction.socialQuote.update({
          where: { id: existing.id },
          data: {
            customerLinkId: customerLink?.id,
            sourceCampaignId: input.sourceCampaignId,
            subtotalMinor,
            totalMinor: subtotalMinor,
            notes: input.notes.trim(),
            sourceSnapshotId: catalog.snapshot.id,
            sourceSnapshotAt: catalog.snapshot.snapshotCreatedAt,
            expiresAt,
            lines: { create: lines },
          },
          include: { lines: true },
        });
      }
      return transaction.socialQuote.create({
        data: {
          connectionId: input.connectionId,
          conversationId: input.conversationId,
          customerLinkId: customerLink?.id,
          sourceCampaignId: input.sourceCampaignId,
          subtotalMinor,
          totalMinor: subtotalMinor,
          notes: input.notes.trim(),
          sourceSnapshotId: catalog.snapshot.id,
          sourceSnapshotAt: catalog.snapshot.snapshotCreatedAt,
          idempotencyKey: input.idempotencyKey,
          createdBy: actor,
          expiresAt,
          lines: { create: lines },
        },
        include: { lines: true },
      });
    });
    await this.commerceEvent(
      input.connectionId,
      quote.id,
      input.id ? 'QUOTE_UPDATED' : 'QUOTE_CREATED',
      actor,
      device.id,
      { subtotalMinor, lineCount: lines.length },
    );
    return quote;
  }

  async sendCommerceQuote(
    device: AuthenticatedDevice,
    quoteId: string,
    actorValue: string,
  ) {
    const quote = await this.quote(device, quoteId);
    if (quote.status !== SocialQuoteStatus.DRAFT) {
      if (
        (
          [
            SocialQuoteStatus.SENT,
            SocialQuoteStatus.READY_TO_IMPORT,
            SocialQuoteStatus.IMPORTING,
            SocialQuoteStatus.IMPORTED,
            SocialQuoteStatus.COMPLETED,
          ] as SocialQuoteStatus[]
        ).includes(quote.status)
      ) {
        return quote;
      }
      throw new ConflictException('Only draft quotes can be sent.');
    }
    if (!quote.lines.length) throw new ConflictException('Quote has no items.');
    const actor = this.actor(actorValue);
    const message = this.quoteMessage(quote);
    await this.reply(device, quote.conversationId, message, actor);
    const updated = await this.prisma.socialQuote.update({
      where: { id: quote.id },
      data: {
        status: SocialQuoteStatus.SENT,
        sentAt: new Date(),
        approvedBy: actor,
      },
      include: { lines: true, customerLink: true },
    });
    await this.commerceEvent(
      quote.connectionId,
      quote.id,
      'QUOTE_SENT',
      actor,
      device.id,
      { totalMinor: quote.totalMinor },
    );
    return updated;
  }

  async acceptCommerceQuote(
    device: AuthenticatedDevice,
    quoteId: string,
    actorValue: string,
  ) {
    const quote = await this.quote(device, quoteId);
    if (quote.status !== SocialQuoteStatus.SENT) {
      if (
        (
          [
            SocialQuoteStatus.READY_TO_IMPORT,
            SocialQuoteStatus.IMPORTING,
            SocialQuoteStatus.IMPORTED,
            SocialQuoteStatus.COMPLETED,
          ] as SocialQuoteStatus[]
        ).includes(quote.status)
      ) {
        return quote;
      }
      throw new ConflictException('Only a sent quote can be accepted.');
    }
    if (quote.expiresAt && quote.expiresAt <= new Date()) {
      await this.prisma.socialQuote.update({
        where: { id: quote.id },
        data: { status: SocialQuoteStatus.EXPIRED },
      });
      throw new ConflictException('This quote has expired.');
    }
    if (!quote.customerLinkId) {
      throw new ConflictException(
        'Link the verified POS customer before accepting this quote.',
      );
    }
    const actor = this.actor(actorValue);
    const updated = await this.prisma.socialQuote.update({
      where: { id: quote.id },
      data: {
        status: SocialQuoteStatus.READY_TO_IMPORT,
        acceptedAt: new Date(),
      },
      include: { lines: true, customerLink: true },
    });
    await this.commerceEvent(
      quote.connectionId,
      quote.id,
      'QUOTE_ACCEPTED',
      actor,
      device.id,
    );
    return updated;
  }

  async cancelCommerceQuote(
    device: AuthenticatedDevice,
    quoteId: string,
    actorValue: string,
  ) {
    const quote = await this.quote(device, quoteId);
    if (quote.status === SocialQuoteStatus.CANCELLED) return quote;
    if (
      (
        [
          SocialQuoteStatus.IMPORTED,
          SocialQuoteStatus.COMPLETED,
        ] as SocialQuoteStatus[]
      ).includes(quote.status)
    ) {
      throw new ConflictException(
        'An imported quote cannot be cancelled here.',
      );
    }
    const actor = this.actor(actorValue);
    const updated = await this.prisma.socialQuote.update({
      where: { id: quote.id },
      data: { status: SocialQuoteStatus.CANCELLED },
      include: { lines: true, customerLink: true },
    });
    await this.commerceEvent(
      quote.connectionId,
      quote.id,
      'QUOTE_CANCELLED',
      actor,
      device.id,
    );
    return updated;
  }

  async claimCommerceImport(
    device: AuthenticatedDevice,
    quoteId: string,
    actorValue: string,
  ) {
    const quote = await this.quote(device, quoteId);
    const actor = this.actor(actorValue);
    if (
      quote.status === SocialQuoteStatus.IMPORTING &&
      quote.importClaimedBy === actor
    ) {
      return quote;
    }
    if (
      !(
        [
          SocialQuoteStatus.READY_TO_IMPORT,
          SocialQuoteStatus.IMPORT_FAILED,
        ] as SocialQuoteStatus[]
      ).includes(quote.status)
    ) {
      throw new ConflictException('This quote is not ready for POS import.');
    }
    if (!quote.customerLink || quote.customerLink.unlinkedAt) {
      throw new ConflictException('The linked POS customer is unavailable.');
    }
    const claimed = await this.prisma.socialQuote.updateMany({
      where: {
        id: quote.id,
        status: {
          in: [
            SocialQuoteStatus.READY_TO_IMPORT,
            SocialQuoteStatus.IMPORT_FAILED,
          ],
        },
      },
      data: {
        status: SocialQuoteStatus.IMPORTING,
        importClaimedBy: actor,
        importClaimedAt: new Date(),
        lastError: null,
      },
    });
    if (!claimed.count) {
      throw new ConflictException('Another till already claimed this quote.');
    }
    await this.commerceEvent(
      quote.connectionId,
      quote.id,
      'IMPORT_CLAIMED',
      actor,
      device.id,
    );
    return this.quote(device, quote.id);
  }

  async completeCommerceImport(
    device: AuthenticatedDevice,
    quoteId: string,
    input: {
      actor: string;
      localQueueId: number;
      localQueueReference: string;
    },
  ) {
    const quote = await this.quote(device, quoteId);
    const actor = this.actor(input.actor);
    if (quote.status === SocialQuoteStatus.IMPORTED) return quote;
    if (
      quote.status !== SocialQuoteStatus.IMPORTING ||
      quote.importClaimedBy !== actor
    ) {
      throw new ConflictException('This till does not own the quote import.');
    }
    const updated = await this.prisma.socialQuote.update({
      where: { id: quote.id },
      data: {
        status: SocialQuoteStatus.IMPORTED,
        localQueueId: input.localQueueId,
        localQueueReference: input.localQueueReference.trim(),
        importedAt: new Date(),
      },
      include: { lines: true, customerLink: true },
    });
    if (quote.sourceCampaignId) {
      await this.prisma.socialAttribution.upsert({
        where: {
          campaignId_localOrderReference: {
            campaignId: quote.sourceCampaignId,
            localOrderReference: input.localQueueReference.trim(),
          },
        },
        create: {
          connectionId: quote.connectionId,
          campaignId: quote.sourceCampaignId,
          conversationId: quote.conversationId,
          quoteId: quote.id,
          localOrderReference: input.localQueueReference.trim(),
          method: 'QUOTE_IMPORT',
          revenueMinor: quote.totalMinor,
        },
        update: { revenueMinor: quote.totalMinor },
      });
    }
    await this.commerceEvent(
      quote.connectionId,
      quote.id,
      'IMPORT_COMPLETED',
      actor,
      device.id,
      {
        localQueueId: input.localQueueId,
        localQueueReference: input.localQueueReference.trim(),
      },
    );
    return updated;
  }

  async failCommerceImport(
    device: AuthenticatedDevice,
    quoteId: string,
    actorValue: string,
    reason: string,
  ) {
    const quote = await this.quote(device, quoteId);
    const actor = this.actor(actorValue);
    if (
      quote.status === SocialQuoteStatus.IMPORT_FAILED &&
      quote.importClaimedBy === actor
    ) {
      return quote;
    }
    if (
      quote.status !== SocialQuoteStatus.IMPORTING ||
      quote.importClaimedBy !== actor
    ) {
      throw new ConflictException('This till does not own the quote import.');
    }
    const updated = await this.prisma.socialQuote.update({
      where: { id: quote.id },
      data: {
        status: SocialQuoteStatus.IMPORT_FAILED,
        lastError: reason.trim().slice(0, 1000),
      },
      include: { lines: true, customerLink: true },
    });
    await this.commerceEvent(
      quote.connectionId,
      quote.id,
      'IMPORT_FAILED',
      actor,
      device.id,
      { reason: reason.trim().slice(0, 300) },
    );
    return updated;
  }

  async campaignSuggestions(device: AuthenticatedDevice, connectionId: string) {
    await this.connection(device, connectionId);
    const result = await this.stores.withClient(device.storeId, (store) =>
      store.inventoryItem.findMany({
        where: { fillQuantity: { gt: 0 } },
        include: { prices: true },
        orderBy: [{ fillQuantity: 'desc' }, { name: 'asc' }],
        take: 12,
      }),
    );
    const snapshotAgeMinutes = Math.max(
      0,
      Math.floor(
        (Date.now() - result.snapshot.snapshotCreatedAt.getTime()) / 60_000,
      ),
    );
    const configuredMaxAge = Number(
      this.config.get<string>('SOCIAL_COMMERCE_MAX_SNAPSHOT_AGE_MINUTES') ?? 15,
    );
    const maxAgeMinutes = Number.isFinite(configuredMaxAge)
      ? Math.max(1, Math.min(24 * 60, configuredMaxAge))
      : 15;
    return {
      snapshot: { ...result.snapshot, ageMinutes: snapshotAgeMinutes },
      suggestions: result.data
        .filter(
          (item) =>
            (item.fillQuantity ?? 0) > Math.max(item.alertLevel ?? 0, 0) &&
            Math.max(
              item.prices?.refill ?? item.sellingPrice ?? 0,
              item.prices?.nonRefill ?? item.sellingPrice ?? 0,
            ) > 0,
        )
        .slice(0, 8)
        .map((item) => ({
          key: `healthy-stock:${result.snapshot.id}:${item.id}`,
          signalType: 'HEALTHY_STOCK',
          title: `Feature ${item.name?.trim() || item.code?.trim() || 'product'}`,
          reason: `${item.fillQuantity ?? 0} fill item(s) available above the safety level.`,
          eligible: snapshotAgeMinutes <= maxAgeMinutes,
          facts: {
            product_name: item.name?.trim() || 'Product',
            product_code: item.code?.trim() || '',
            product_size: item.size?.trim() || '',
            price: this.moneyLabel(
              this.moneyMinor(item.prices?.refill ?? item.sellingPrice ?? 0),
            ),
            call_to_action: 'Message us for availability and delivery details.',
          },
        })),
    };
  }

  async campaigns(device: AuthenticatedDevice, connectionId?: string) {
    if (connectionId) await this.connection(device, connectionId);
    const campaigns = await this.prisma.socialCampaign.findMany({
      where: {
        connection: { clientId: device.clientId, storeId: device.storeId },
        ...(connectionId ? { connectionId } : {}),
      },
      include: {
        variants: { orderBy: { createdAt: 'asc' } },
        quotes: { select: { status: true, totalMinor: true } },
        attributions: { select: { revenueMinor: true } },
      },
      orderBy: { updatedAt: 'desc' },
      take: 100,
    });
    const postIds = campaigns.flatMap((campaign) =>
      campaign.variants.flatMap((variant) =>
        variant.postId ? [variant.postId] : [],
      ),
    );
    const posts = postIds.length
      ? await this.prisma.socialPost.findMany({
          where: { id: { in: postIds } },
          select: { id: true, status: true, publishedAt: true },
        })
      : [];
    const postMap = new Map(posts.map((post) => [post.id, post]));
    return campaigns.map((campaign) => {
      const campaignPosts = campaign.variants
        .flatMap((variant) =>
          variant.postId ? [postMap.get(variant.postId)] : [],
        )
        .filter((post): post is NonNullable<typeof post> => Boolean(post));
      const status =
        campaign.status === SocialCampaignStatus.PAUSED
          ? campaign.status
          : campaignPosts.some(
                (post) => post.status === SocialPostStatus.PUBLISHED,
              )
            ? SocialCampaignStatus.ACTIVE
            : campaignPosts.some(
                  (post) => post.status === SocialPostStatus.SCHEDULED,
                )
              ? SocialCampaignStatus.SCHEDULED
              : campaignPosts.some(
                    (post) => post.status === SocialPostStatus.FAILED,
                  )
                ? SocialCampaignStatus.FAILED
                : campaignPosts.some(
                      (post) => post.status === SocialPostStatus.CANCELLED,
                    )
                  ? SocialCampaignStatus.CANCELLED
                  : campaign.status;
      return {
        ...campaign,
        status,
        variants: campaign.variants.map((variant) => ({
          ...variant,
          post: variant.postId ? (postMap.get(variant.postId) ?? null) : null,
        })),
        metrics: {
          published: campaign.variants.some(
            (variant) =>
              variant.postId &&
              postMap.get(variant.postId)?.status ===
                SocialPostStatus.PUBLISHED,
          )
            ? 1
            : 0,
          quotesSent: campaign.quotes.filter((quote) =>
            (
              [
                SocialQuoteStatus.SENT,
                SocialQuoteStatus.READY_TO_IMPORT,
                SocialQuoteStatus.IMPORTING,
                SocialQuoteStatus.IMPORTED,
                SocialQuoteStatus.COMPLETED,
              ] as SocialQuoteStatus[]
            ).includes(quote.status),
          ).length,
          quotesAccepted: campaign.quotes.filter((quote) =>
            (
              [
                SocialQuoteStatus.READY_TO_IMPORT,
                SocialQuoteStatus.IMPORTING,
                SocialQuoteStatus.IMPORTED,
                SocialQuoteStatus.COMPLETED,
              ] as SocialQuoteStatus[]
            ).includes(quote.status),
          ).length,
          ordersImported: campaign.quotes.filter((quote) =>
            (
              [
                SocialQuoteStatus.IMPORTED,
                SocialQuoteStatus.COMPLETED,
              ] as SocialQuoteStatus[]
            ).includes(quote.status),
          ).length,
          revenueMinor: campaign.attributions.reduce(
            (sum, attribution) => sum + attribution.revenueMinor,
            0,
          ),
        },
      };
    });
  }

  async createCampaign(
    device: AuthenticatedDevice,
    input: {
      connectionId: string;
      signalId?: string;
      name: string;
      goal: string;
      facts: Record<string, string>;
      variants: string[];
      selectedVariant: number;
      scheduledAt?: string;
      actor: string;
    },
  ) {
    await this.connection(device, input.connectionId, true);
    const variants = input.variants
      .map((value) => value.trim())
      .filter(Boolean);
    const selected = variants[input.selectedVariant];
    if (!selected) throw new BadRequestException('Select a caption variant.');
    const facts = Object.fromEntries(
      Object.entries(input.facts)
        .filter(
          ([key, value]) =>
            /^[a-z][a-z0-9_]{0,39}$/i.test(key) && typeof value === 'string',
        )
        .map(([key, value]) => [key, value.trim().slice(0, 500)]),
    );
    const validationMessages = this.validateCampaignFacts(selected, facts);
    if (validationMessages.length) {
      throw new BadRequestException(validationMessages.join(' '));
    }
    const actor = this.actor(input.actor);
    const factsHash = this.hash(JSON.stringify(facts));
    const trackingCode = `SOC-${randomBytes(5).toString('hex').toUpperCase()}`;
    const scheduledAt = input.scheduledAt ? new Date(input.scheduledAt) : null;
    return this.prisma.$transaction(async (transaction) => {
      const campaign = await transaction.socialCampaign.create({
        data: {
          connectionId: input.connectionId,
          signalId: input.signalId,
          name: input.name.trim(),
          goal: input.goal.trim(),
          status: SocialCampaignStatus.AWAITING_APPROVAL,
          facts: facts as Prisma.InputJsonValue,
          trackingCode,
          createdBy: actor,
          startsAt: scheduledAt,
        },
      });
      const post = await transaction.socialPost.create({
        data: {
          connectionId: input.connectionId,
          content: `${selected}\n\nReference: ${trackingCode}`,
          status: SocialPostStatus.AWAITING_APPROVAL,
          scheduledAt,
          idempotencyKey: `campaign:${campaign.id}`,
          createdBy: actor,
          generationMetadata: {
            campaignId: campaign.id,
            factsHash,
            trackingCode,
          },
        },
      });
      await transaction.socialCampaignVariant.createMany({
        data: variants.map((content, index) => ({
          campaignId: campaign.id,
          content,
          factsHash,
          provider: 'GEMINI_OR_FALLBACK',
          validationPassed: !this.validateCampaignFacts(content, facts).length,
          validationMessages: this.validateCampaignFacts(content, facts),
          selected: index === input.selectedVariant,
          postId: index === input.selectedVariant ? post.id : null,
        })),
      });
      return transaction.socialCampaign.findUniqueOrThrow({
        where: { id: campaign.id },
        include: { variants: true },
      });
    });
  }

  async pauseCampaign(device: AuthenticatedDevice, id: string) {
    const campaign = await this.campaign(device, id);
    if (
      (
        [
          SocialCampaignStatus.COMPLETED,
          SocialCampaignStatus.CANCELLED,
        ] as SocialCampaignStatus[]
      ).includes(campaign.status)
    ) {
      throw new ConflictException('This campaign can no longer be paused.');
    }
    const variants = await this.prisma.socialCampaignVariant.findMany({
      where: { campaignId: campaign.id, postId: { not: null } },
      select: { postId: true },
    });
    const postIds = variants.flatMap((variant) =>
      variant.postId ? [variant.postId] : [],
    );
    return this.prisma.$transaction(async (transaction) => {
      if (postIds.length) {
        await transaction.socialPost.updateMany({
          where: {
            id: { in: postIds },
            status: {
              in: [
                SocialPostStatus.AWAITING_APPROVAL,
                SocialPostStatus.SCHEDULED,
                SocialPostStatus.FAILED,
              ],
            },
          },
          data: { status: SocialPostStatus.CANCELLED },
        });
      }
      return transaction.socialCampaign.update({
        where: { id: campaign.id },
        data: { status: SocialCampaignStatus.PAUSED, pausedAt: new Date() },
        include: { variants: true },
      });
    });
  }

  verifyWebhookSignature(
    rawBody: Buffer | undefined,
    signature: string | undefined,
  ): boolean {
    const secret = this.config.get<string>('META_APP_SECRET') ?? '';
    if (!secret || !rawBody || !signature?.startsWith('sha256=')) return false;
    const expected = createHmac('sha256', secret).update(rawBody).digest('hex');
    const received = signature.slice(7).toLowerCase();
    if (expected.length !== received.length) return false;
    return timingSafeEqual(Buffer.from(expected), Buffer.from(received));
  }

  webhookChallenge(
    mode?: string,
    verifyToken?: string,
    challenge?: string,
  ): string | null {
    const expected = this.config.get<string>('META_WEBHOOK_VERIFY_TOKEN') ?? '';
    return mode === 'subscribe' &&
      expected &&
      verifyToken === expected &&
      challenge
      ? challenge
      : null;
  }

  async ingestWebhook(payload: MetaWebhookPayload) {
    const eventHash = this.hash(JSON.stringify(payload));
    const existing = await this.prisma.socialWebhookEvent.findUnique({
      where: { eventHash },
    });
    if (existing) return { accepted: true, duplicate: true };
    const pageId = payload.entry?.find((entry) => entry.id)?.id;
    const connection = pageId
      ? await this.prisma.socialConnection.findFirst({
          where: { pageId, status: SocialConnectionStatus.ACTIVE },
        })
      : null;
    const event = await this.prisma.socialWebhookEvent.create({
      data: {
        connectionId: connection?.id,
        eventHash,
        payload: payload as unknown as Prisma.InputJsonValue,
      },
    });
    queueMicrotask(() =>
      this.runBackgroundTask('webhook delivery', () =>
        this.processWebhookEvent(event.id),
      ),
    );
    return { accepted: true, duplicate: false };
  }

  private async processWebhookEvent(id: string): Promise<void> {
    const staleBefore = new Date(Date.now() - 5 * 60_000);
    const claimed = await this.prisma.socialWebhookEvent.updateMany({
      where: {
        id,
        attemptCount: { lt: 5 },
        OR: [
          { status: { in: ['RECEIVED', 'FAILED'] } },
          {
            status: 'PROCESSING',
            processingStartedAt: { lt: staleBefore },
          },
        ],
      },
      data: {
        status: 'PROCESSING',
        processingStartedAt: new Date(),
        attemptCount: { increment: 1 },
        lastError: null,
      },
    });
    if (!claimed.count) return;
    const event = await this.prisma.socialWebhookEvent.findUnique({
      where: { id },
    });
    if (!event) return;
    try {
      const payload = event.payload as unknown as MetaWebhookPayload;
      for (const entry of payload.entry ?? []) {
        if (!entry.id) continue;
        const connection = await this.prisma.socialConnection.findFirst({
          where: { pageId: entry.id, status: SocialConnectionStatus.ACTIVE },
        });
        if (!connection) continue;
        for (const item of entry.messaging ?? []) {
          const message = item.message;
          const participantId = item.sender?.id;
          if (
            !message ||
            message.is_echo ||
            !participantId ||
            participantId === connection.pageId
          )
            continue;
          if (
            message.mid &&
            (await this.prisma.socialMessage.findUnique({
              where: {
                connectionId_providerMessageId: {
                  connectionId: connection.id,
                  providerMessageId: message.mid,
                },
              },
              select: { id: true },
            }))
          )
            continue;
          const sentAt = item.timestamp ? new Date(item.timestamp) : new Date();
          const conversation = await this.prisma.socialConversation.upsert({
            where: {
              connectionId_participantId: {
                connectionId: connection.id,
                participantId,
              },
            },
            create: {
              connectionId: connection.id,
              participantId,
              status: SocialConversationStatus.WAITING,
              lastInboundAt: sentAt,
              lastMessageAt: sentAt,
              unreadCount: 1,
            },
            update: {
              status: { set: SocialConversationStatus.WAITING },
              lastInboundAt: sentAt,
              lastMessageAt: sentAt,
              unreadCount: { increment: 1 },
              resolvedAt: null,
            },
          });
          if (
            !conversation.participantName ||
            !conversation.participantPictureUrl
          ) {
            const participantProfile = await this.participantProfile(
              connection,
              participantId,
            );
            const participantName =
              conversation.participantName === null
                ? participantProfile?.name
                : null;
            const participantPictureUrl =
              conversation.participantPictureUrl === null
                ? participantProfile?.pictureUrl
                : null;
            if (participantName || participantPictureUrl) {
              await this.prisma.socialConversation.update({
                where: { id: conversation.id },
                data: {
                  ...(participantName ? { participantName } : {}),
                  ...(participantPictureUrl ? { participantPictureUrl } : {}),
                },
              });
            }
          }
          if (message.mid) {
            await this.prisma.socialMessage.upsert({
              where: {
                connectionId_providerMessageId: {
                  connectionId: connection.id,
                  providerMessageId: message.mid,
                },
              },
              create: {
                connectionId: connection.id,
                conversationId: conversation.id,
                providerMessageId: message.mid,
                direction: SocialMessageDirection.INBOUND,
                sender: SocialMessageSender.CUSTOMER,
                text: message.text,
                attachments: (message.attachments ??
                  []) as Prisma.InputJsonValue,
                sentAt,
              },
              update: {},
            });
          }
          if (message.text)
            await this.tryFaqReply(connection, conversation, message.text);
        }
      }
      await this.prisma.socialWebhookEvent.update({
        where: { id },
        data: {
          status: 'PROCESSED',
          processedAt: new Date(),
          processingStartedAt: null,
        },
      });
    } catch (error) {
      this.logger.error(
        `Social webhook ${id} failed: ${this.errorMessage(error)}`,
      );
      await this.prisma.socialWebhookEvent.update({
        where: { id },
        data: {
          status: 'FAILED',
          lastError: this.errorMessage(error),
          processingStartedAt: null,
        },
      });
    }
  }

  private async participantProfile(
    connection: { id: string; tokenCiphertext: string },
    participantId: string,
  ): Promise<{ name: string | null; pictureUrl: string | null } | null> {
    try {
      const profile = await this.meta.userProfile(
        participantId,
        this.vault.decrypt(connection.tokenCiphertext),
      );
      const pictureUrl = profile.pictureUrl?.startsWith('https://')
        ? profile.pictureUrl
        : null;
      return {
        name: profile.name?.slice(0, 180) || null,
        pictureUrl,
      };
    } catch (error) {
      this.logger.warn(
        `Messenger profile lookup failed for connection ${connection.id}: ${this.errorMessage(error)}`,
      );
      return null;
    }
  }

  private async tryFaqReply(
    connection: { id: string; pageId: string; tokenCiphertext: string },
    conversation: {
      id: string;
      participantId: string;
      automationMode: string;
      assignedTo: string | null;
    },
    text: string,
  ): Promise<void> {
    if (
      conversation.assignedTo ||
      conversation.automationMode === SocialAutomationMode.OFF
    )
      return;
    const available = await this.prisma.socialCashierPresence.count({
      where: {
        connectionId: connection.id,
        availability: 'AVAILABLE',
        lastSeenAt: { gte: new Date(Date.now() - 90_000) },
      },
    });
    if (available) return;
    const faqs = await this.prisma.socialFaq.findMany({
      where: { connectionId: connection.id, enabled: true },
      take: 100,
    });
    const faq = this.matchFaq(text, faqs);
    if (!faq) return;
    const providerMessageId = await this.meta.sendMessage(
      connection.pageId,
      this.vault.decrypt(connection.tokenCiphertext),
      conversation.participantId,
      faq.answer,
    );
    const sentAt = new Date();
    await this.prisma.socialMessage.create({
      data: {
        connectionId: connection.id,
        conversationId: conversation.id,
        providerMessageId,
        direction: SocialMessageDirection.OUTBOUND,
        sender: SocialMessageSender.BOT,
        senderName: 'FAQ assistant',
        text: faq.answer,
        deliveryStatus: 'SENT',
        sentAt,
      },
    });
    await this.prisma.socialConversation.update({
      where: { id: conversation.id },
      data: { lastMessageAt: sentAt },
    });
  }

  private matchFaq<
    T extends { answer: string; question: string; keywords: string[] },
  >(text: string, faqs: T[]): T | undefined {
    const normalized = text.toLowerCase().replace(/[^a-z0-9\s]/g, ' ');
    return faqs.find((faq) =>
      [...faq.keywords, faq.question]
        .map((value) => value.toLowerCase().trim())
        .filter((value) => value.length >= 3)
        .some((value) => normalized.includes(value)),
    );
  }

  private async publishDuePosts(): Promise<void> {
    const due = await this.prisma.socialPost.findMany({
      where: {
        status: SocialPostStatus.SCHEDULED,
        OR: [{ scheduledAt: null }, { scheduledAt: { lte: new Date() } }],
      },
      select: { id: true },
      orderBy: { scheduledAt: 'asc' },
      take: 20,
    });
    for (const post of due)
      await this.publishPost(post.id).catch(() => undefined);
  }

  private async processPendingWebhookEvents(): Promise<void> {
    const staleBefore = new Date(Date.now() - 5 * 60_000);
    const events = await this.prisma.socialWebhookEvent.findMany({
      where: {
        attemptCount: { lt: 5 },
        OR: [
          { status: { in: ['RECEIVED', 'FAILED'] } },
          {
            status: 'PROCESSING',
            processingStartedAt: { lt: staleBefore },
          },
        ],
      },
      select: { id: true },
      orderBy: { receivedAt: 'asc' },
      take: 20,
    });
    for (const event of events) await this.processWebhookEvent(event.id);
  }

  private runScheduledWork(): void {
    this.runBackgroundTask('scheduled publishing', () =>
      this.publishDuePosts(),
    );
    this.runBackgroundTask('webhook retry', () =>
      this.processPendingWebhookEvents(),
    );
  }

  private runBackgroundTask(label: string, task: () => Promise<void>): void {
    void task().catch((error: unknown) =>
      this.logger.error(`${label} failed: ${this.errorMessage(error)}`),
    );
  }

  private async publishPost(id: string) {
    const claimed = await this.prisma.socialPost.updateMany({
      where: { id, status: SocialPostStatus.SCHEDULED },
      data: {
        status: SocialPostStatus.PUBLISHING,
        lastAttemptAt: new Date(),
        attemptCount: { increment: 1 },
      },
    });
    if (!claimed.count)
      return this.prisma.socialPost.findUniqueOrThrow({ where: { id } });
    const post = await this.prisma.socialPost.findUniqueOrThrow({
      where: { id },
      include: { connection: true },
    });
    try {
      if (post.connection.status !== SocialConnectionStatus.ACTIVE) {
        throw new ConflictException(
          'The Facebook Page connection requires attention.',
        );
      }
      const providerPostId = await this.meta.publishPost(
        post.connection.pageId,
        this.vault.decrypt(post.connection.tokenCiphertext),
        post.content,
      );
      return this.prisma.socialPost.update({
        where: { id },
        data: {
          status: SocialPostStatus.PUBLISHED,
          providerPostId,
          publishedAt: new Date(),
          lastError: null,
        },
      });
    } catch (error) {
      const message = this.errorMessage(error);
      await this.prisma.socialPost.update({
        where: { id },
        data: { status: SocialPostStatus.FAILED, lastError: message },
      });
      throw error;
    }
  }

  private async saveConnection(
    attempt: { clientId: string; storeId: string; actor: string },
    credential: MetaPageCredential,
  ) {
    return this.upsertConnection(
      attempt.clientId,
      attempt.storeId,
      attempt.actor,
      credential,
    );
  }

  private async upsertConnection(
    clientId: string,
    storeId: string,
    actor: string,
    credential: MetaPageCredential,
  ) {
    return this.prisma.socialConnection.upsert({
      where: { storeId_pageId: { storeId, pageId: credential.id } },
      create: {
        clientId,
        storeId,
        pageId: credential.id,
        pageName: credential.name,
        tokenCiphertext: this.vault.encrypt(credential.accessToken),
        grantedPermissions: credential.permissions,
        pageTasks: credential.tasks,
        connectedBy: actor,
        lastCheckedAt: new Date(),
      },
      update: {
        pageName: credential.name,
        tokenCiphertext: this.vault.encrypt(credential.accessToken),
        grantedPermissions: credential.permissions,
        pageTasks: credential.tasks,
        status: SocialConnectionStatus.ACTIVE,
        connectedBy: actor,
        connectedAt: new Date(),
        disconnectedAt: null,
        lastCheckedAt: new Date(),
        lastError: null,
      },
    });
  }

  private async connection(
    device: AuthenticatedDevice,
    id: string,
    requireActive = false,
  ) {
    const connection = await this.prisma.socialConnection.findFirst({
      where: { id, clientId: device.clientId, storeId: device.storeId },
    });
    if (!connection)
      throw new NotFoundException('Social connection not found.');
    if (requireActive && connection.status !== SocialConnectionStatus.ACTIVE) {
      throw new ConflictException(
        'The Facebook Page connection requires attention.',
      );
    }
    return connection;
  }

  private async post(device: AuthenticatedDevice, id: string) {
    const post = await this.prisma.socialPost.findFirst({
      where: {
        id,
        connection: { clientId: device.clientId, storeId: device.storeId },
      },
    });
    if (!post) throw new NotFoundException('Social post not found.');
    return post;
  }

  private async conversation(device: AuthenticatedDevice, id: string) {
    const conversation = await this.prisma.socialConversation.findFirst({
      where: {
        id,
        connection: { clientId: device.clientId, storeId: device.storeId },
      },
    });
    if (!conversation) throw new NotFoundException('Conversation not found.');
    return conversation;
  }

  private async quote(device: AuthenticatedDevice, id: string) {
    const quote = await this.prisma.socialQuote.findFirst({
      where: {
        id,
        connection: { clientId: device.clientId, storeId: device.storeId },
      },
      include: {
        lines: { orderBy: { createdAt: 'asc' } },
        customerLink: true,
      },
    });
    if (!quote) throw new NotFoundException('Quote not found.');
    return quote;
  }

  private async campaign(device: AuthenticatedDevice, id: string) {
    const campaign = await this.prisma.socialCampaign.findFirst({
      where: {
        id,
        connection: { clientId: device.clientId, storeId: device.storeId },
      },
    });
    if (!campaign) throw new NotFoundException('Campaign not found.');
    return campaign;
  }

  private commerceEvent(
    connectionId: string,
    quoteId: string | null,
    eventType: string,
    actor: string,
    deviceId?: string,
    metadata: Record<string, unknown> = {},
  ) {
    return this.prisma.socialCommerceEvent.create({
      data: {
        connectionId,
        quoteId,
        eventType,
        actor,
        deviceId,
        metadata: metadata as Prisma.InputJsonValue,
      },
    });
  }

  private moneyMinor(value: number): number {
    if (!Number.isFinite(value) || value < 0) return 0;
    return Math.round(value * 100);
  }

  private moneyLabel(valueMinor: number): string {
    return `PHP ${(valueMinor / 100).toLocaleString('en-PH', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;
  }

  private quoteMessage(quote: {
    lines: Array<{
      itemName: string;
      itemSize: string;
      unit: string;
      quantity: number;
      lineTotalMinor: number;
    }>;
    totalMinor: number;
    notes: string;
    expiresAt: Date | null;
  }): string {
    const lines = quote.lines.map(
      (line) =>
        `${line.quantity} × ${line.itemName}${line.itemSize ? ` ${line.itemSize}` : ''} (${line.unit === 'REFILL' ? 'Refill' : 'Non-refill'}) — ${this.moneyLabel(line.lineTotalMinor)}`,
    );
    return [
      'Here is your requested quotation:',
      '',
      ...lines,
      '',
      `Total: ${this.moneyLabel(quote.totalMinor)}`,
      quote.notes ? `Notes: ${quote.notes}` : '',
      quote.expiresAt
        ? `Valid until: ${quote.expiresAt.toLocaleString('en-PH', { timeZone: 'Asia/Manila' })}`
        : '',
      '',
      'Stock and final pricing will be confirmed by the cashier before checkout.',
    ]
      .filter((line) => line !== '')
      .join('\n');
  }

  private validateCampaignFacts(
    content: string,
    facts: Record<string, string>,
  ): string[] {
    const messages: string[] = [];
    for (const [key, value] of Object.entries(facts)) {
      if (!value || !/(price|date|phone|contact|promo|discount)/i.test(key)) {
        continue;
      }
      if (!content.toLocaleLowerCase().includes(value.toLocaleLowerCase())) {
        messages.push(`The selected caption must preserve ${key} exactly.`);
      }
    }
    return messages;
  }

  private publicConnection(connection: {
    tokenCiphertext: string;
    grantedPermissions: string[];
    [key: string]: unknown;
  }): Record<string, unknown> {
    const value = Object.fromEntries(
      Object.entries(connection).filter(([key]) => key !== 'tokenCiphertext'),
    );
    const permissions = new Set(
      Array.isArray(value.grantedPermissions) ? value.grantedPermissions : [],
    );
    return {
      ...value,
      capabilities: {
        publish: permissions.has('pages_manage_posts'),
        messaging: permissions.has('pages_messaging'),
        webhooks: permissions.has('pages_manage_metadata'),
      },
    };
  }

  private replyMode(lastInboundAt: Date | null): 'OPEN_24H' | 'CLOSED' {
    return lastInboundAt &&
      Date.now() - lastInboundAt.getTime() <= 24 * 60 * 60_000
      ? 'OPEN_24H'
      : 'CLOSED';
  }

  private actor(value: string): string {
    const actor = value.trim().slice(0, 120);
    if (!actor) throw new BadRequestException('POS actor is required.');
    return actor;
  }

  private hash(value: string): string {
    return createHash('sha256').update(value).digest('hex');
  }

  private objectString(value: unknown, key: string): string | undefined {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return undefined;
    }
    const candidate = (value as Record<string, unknown>)[key];
    return typeof candidate === 'string' ? candidate : undefined;
  }

  private objectStringArray(value: unknown, key: string): string[] {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
    const candidate = (value as Record<string, unknown>)[key];
    return Array.isArray(candidate)
      ? candidate.filter((item): item is string => typeof item === 'string')
      : [];
  }

  private errorMessage(error: unknown): string {
    if (error && typeof error === 'object' && 'message' in error) {
      const message = error.message;
      if (typeof message === 'string') return message.slice(0, 1000);
    }
    return 'The social operation failed.';
  }
}
