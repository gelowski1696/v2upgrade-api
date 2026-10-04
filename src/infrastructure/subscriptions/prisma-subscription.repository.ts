import { Injectable } from '@nestjs/common';
import type { Page, PageQuery } from '../../domain/shared/page.js';
import { toPage } from '../../domain/shared/page.js';
import type {
  CreateSubscriptionInput,
  CreateGroupSubscriptionsInput,
  DeviceLicenseRecord,
  GroupSubscriptionOptions,
  SubscriptionEventRecord,
  SubscriptionRecord,
  SubscriptionRepository,
  SubscriptionRenewalRecord,
  SubscriptionRenewalResult,
  SubscriptionStatus,
} from '../../domain/subscriptions/subscription.repository.js';
import { ConflictError } from '../../domain/shared/errors.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../database/prisma.service.js';

const subscriptionInclude = {
  client: { select: { id: true, code: true, businessName: true } },
  planVersion: {
    select: {
      id: true,
      version: true,
      features: true,
      plan: { select: { id: true, code: true, name: true } },
    },
  },
  devices: {
    orderBy: { createdAt: 'asc' as const },
    take: 1,
    select: {
      id: true,
      installationId: true,
      label: true,
      platform: true,
      status: true,
      lastSeenAt: true,
    },
  },
} satisfies Prisma.SubscriptionInclude;

type SubscriptionWithRelations = Prisma.SubscriptionGetPayload<{
  include: typeof subscriptionInclude;
}>;

@Injectable()
export class PrismaSubscriptionRepository implements SubscriptionRepository {
  constructor(private readonly prisma: PrismaService) {}

  async list(
    query: PageQuery & { status?: SubscriptionStatus; clientId?: string },
  ): Promise<Page<SubscriptionRecord>> {
    const where: Prisma.SubscriptionWhereInput = {
      deletedAt: null,
      status: query.status,
      clientId: query.clientId,
      ...(query.search
        ? {
            OR: [
              {
                client: {
                  code: { contains: query.search, mode: 'insensitive' },
                },
              },
              {
                client: {
                  businessName: { contains: query.search, mode: 'insensitive' },
                },
              },
              {
                planVersion: {
                  plan: {
                    name: { contains: query.search, mode: 'insensitive' },
                  },
                },
              },
            ],
          }
        : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.subscription.findMany({
        where,
        include: subscriptionInclude,
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.subscription.count({ where }),
    ]);
    return toPage(
      items.map((item) => this.map(item)),
      total,
      query.page,
      query.pageSize,
    );
  }

  async findById(id: string): Promise<SubscriptionRecord | null> {
    const subscription = await this.prisma.subscription.findFirst({
      where: { id, deletedAt: null },
      include: subscriptionInclude,
    });
    return subscription ? this.map(subscription) : null;
  }

  async findByDeviceId(
    deviceInstallationId: string,
  ): Promise<DeviceLicenseRecord | null> {
    const device = await this.prisma.device.findUnique({
      where: { installationId: deviceInstallationId },
      include: {
        subscription: { include: subscriptionInclude },
      },
    });
    if (!device) return null;
    return {
      id: device.id,
      clientId: device.clientId,
      storeId: device.storeId,
      installationId: device.installationId,
      status: device.status,
      subscription: device.subscription ? this.map(device.subscription) : null,
    };
  }

  async touchDevice(id: string, seenAt: Date): Promise<void> {
    await this.prisma.device.update({
      where: { id },
      data: { lastSeenAt: seenAt },
    });
  }

  async assignDevice(
    subscriptionId: string,
    clientId: string,
    deviceInstallationId: string,
  ): Promise<SubscriptionRecord> {
    try {
      await this.prisma.$transaction(async (transaction) => {
        const store = await transaction.store.findFirstOrThrow({
          where: { clientId, status: 'ACTIVE' },
          orderBy: { createdAt: 'asc' },
          select: { id: true },
        });
        const existing = await transaction.device.findFirst({
          where: { subscriptionId },
          select: { id: true },
        });
        if (existing) {
          await transaction.device.update({
            where: { id: existing.id },
            data: {
              installationId: deviceInstallationId,
              storeId: store.id,
              status: 'ACTIVE',
              revokedAt: null,
            },
          });
        } else {
          await transaction.device.create({
            data: {
              subscriptionId,
              clientId,
              storeId: store.id,
              installationId: deviceInstallationId,
              label: 'Primary POS',
              platform: 'windows',
            },
          });
        }
      });
    } catch (error) {
      this.rethrowDeviceConflict(error);
    }
    return (await this.findById(subscriptionId)) as SubscriptionRecord;
  }

  async create(input: CreateSubscriptionInput): Promise<SubscriptionRecord> {
    const { deviceInstallationId, ...subscriptionInput } = input;
    try {
      const store = await this.prisma.store.findFirstOrThrow({
        where: { clientId: input.clientId, status: 'ACTIVE' },
        orderBy: { createdAt: 'asc' },
        select: { id: true },
      });
      const subscription = await this.prisma.subscription.create({
        data: {
          ...subscriptionInput,
          entitlements: input.entitlements as Prisma.InputJsonValue,
          devices: {
            create: {
              clientId: input.clientId,
              storeId: store.id,
              installationId: deviceInstallationId,
              label: 'Primary POS',
              platform: 'windows',
            },
          },
          events: {
            create: {
              toStatus: 'DRAFT',
              reason: 'Subscription created',
              actorId: input.createdById,
            },
          },
        },
        include: subscriptionInclude,
      });
      return this.map(subscription);
    } catch (error) {
      this.rethrowDeviceConflict(error);
    }
  }

  async groupCreationOptions(
    groupId: string,
  ): Promise<GroupSubscriptionOptions | null> {
    const group = await this.prisma.clientGroup.findUnique({
      where: { id: groupId },
      select: {
        id: true,
        code: true,
        name: true,
        status: true,
        clients: {
          where: { status: 'ACTIVE' },
          orderBy: [{ businessName: 'asc' }, { code: 'asc' }],
          select: {
            id: true,
            code: true,
            businessName: true,
            ownerName: true,
            notes: true,
            stores: {
              where: { status: 'ACTIVE' },
              take: 1,
              select: { id: true },
            },
            subscriptions: {
              where: { deletedAt: null, status: { not: 'CANCELLED' } },
              orderBy: { createdAt: 'desc' },
              take: 1,
              select: {
                id: true,
                status: true,
                planVersion: { select: { plan: { select: { name: true } } } },
              },
            },
          },
        },
      },
    });
    if (!group) return null;
    return {
      group: {
        id: group.id,
        code: group.code,
        name: group.name,
        status: group.status,
      },
      members: group.clients.map((client) => ({
        clientId: client.id,
        code: client.code,
        businessName: client.businessName,
        ownerName: client.ownerName,
        suggestedDeviceId: this.legacyDeviceId(client.notes),
        hasActiveStore: client.stores.length > 0,
        currentSubscription: client.subscriptions[0]
          ? {
              id: client.subscriptions[0].id,
              status: client.subscriptions[0].status,
              planName: client.subscriptions[0].planVersion.plan.name,
            }
          : null,
      })),
    };
  }

  async createGroup(
    input: CreateGroupSubscriptionsInput,
  ): Promise<SubscriptionRecord[]> {
    try {
      return await this.prisma.$transaction(
        async (transaction) => {
          const group = await transaction.clientGroup.findFirst({
            where: { id: input.groupId, status: 'ACTIVE' },
            select: { id: true },
          });
          if (!group) {
            throw new ConflictError(
              'The client group is no longer active. Refresh and try again.',
              'GROUP_NOT_ACTIVE',
            );
          }

          const memberIds = input.members.map((member) => member.clientId);
          const clients = await transaction.client.findMany({
            where: {
              id: { in: memberIds },
              groupId: input.groupId,
              status: 'ACTIVE',
            },
            select: {
              id: true,
              code: true,
              stores: {
                where: { status: 'ACTIVE' },
                orderBy: { createdAt: 'asc' },
                take: 1,
                select: { id: true },
              },
              subscriptions: {
                where: { deletedAt: null, status: { not: 'CANCELLED' } },
                take: 1,
                select: { id: true },
              },
            },
          });
          if (clients.length !== memberIds.length) {
            throw new ConflictError(
              'One or more selected clients are no longer active members of this group.',
              'GROUP_MEMBERS_CHANGED',
            );
          }
          const existingCodes = clients
            .filter((client) => client.subscriptions.length > 0)
            .map((client) => client.code);
          if (existingCodes.length) {
            throw new ConflictError(
              `Subscriptions already exist for: ${existingCodes.join(', ')}. Refresh the group list.`,
              'GROUP_MEMBER_ALREADY_SUBSCRIBED',
            );
          }
          const missingStoreCodes = clients
            .filter((client) => client.stores.length === 0)
            .map((client) => client.code);
          if (missingStoreCodes.length) {
            throw new ConflictError(
              `Active stores are missing for: ${missingStoreCodes.join(', ')}.`,
              'GROUP_MEMBER_STORE_MISSING',
            );
          }

          const installationIds = input.members.map(
            (member) => member.deviceInstallationId,
          );
          const assignedDevices = await transaction.device.findMany({
            where: { installationId: { in: installationIds } },
            select: { installationId: true },
          });
          if (assignedDevices.length) {
            throw new ConflictError(
              `Device IDs are already assigned: ${assignedDevices.map((device) => device.installationId).join(', ')}.`,
              'DEVICE_ALREADY_ASSIGNED',
            );
          }

          const clientsById = new Map(
            clients.map((client) => [client.id, client]),
          );
          const created: SubscriptionRecord[] = [];
          for (const member of input.members) {
            const client = clientsById.get(member.clientId);
            if (!client?.stores[0]) continue;
            const subscription = await transaction.subscription.create({
              data: {
                clientId: member.clientId,
                planVersionId: input.planVersionId,
                startsAt: input.startsAt,
                renewsAt: input.renewsAt,
                expiresAt: input.expiresAt,
                amount: input.amount,
                currency: input.currency,
                billingInterval: input.billingInterval,
                maxDevices: input.maxDevices,
                entitlements: input.entitlements as Prisma.InputJsonValue,
                notes: input.notes,
                createdById: input.createdById,
                devices: {
                  create: {
                    clientId: member.clientId,
                    storeId: client.stores[0].id,
                    installationId: member.deviceInstallationId,
                    label: 'Primary POS',
                    platform: 'windows',
                  },
                },
                events: {
                  create: {
                    toStatus: 'DRAFT',
                    reason: 'Subscription created with client group',
                    actorId: input.createdById,
                  },
                },
              },
              include: subscriptionInclude,
            });
            created.push(this.map(subscription));
          }
          return created;
        },
        { maxWait: 10_000, timeout: 30_000 },
      );
    } catch (error) {
      this.rethrowDeviceConflict(error);
    }
  }

  async updateEntitlements(
    id: string,
    entitlements: Record<string, unknown>,
  ): Promise<SubscriptionRecord> {
    const subscription = await this.prisma.subscription.update({
      where: { id },
      data: { entitlements: entitlements as Prisma.InputJsonValue },
      include: subscriptionInclude,
    });
    return this.map(subscription);
  }

  async transition(
    id: string,
    fromStatus: SubscriptionStatus,
    toStatus: SubscriptionStatus,
    actorId: string,
    reason?: string,
  ): Promise<SubscriptionRecord> {
    await this.prisma.$transaction(async (transaction) => {
      const result = await transaction.subscription.updateMany({
        where: { id, status: fromStatus },
        data: {
          status: toStatus,
          suspendedAt: toStatus === 'SUSPENDED' ? new Date() : undefined,
          cancelledAt: toStatus === 'CANCELLED' ? new Date() : undefined,
        },
      });
      if (result.count !== 1) {
        throw new ConflictError(
          'The subscription changed while this action was being completed. Refresh and try again.',
          'SUBSCRIPTION_CONCURRENT_CHANGE',
        );
      }
      await transaction.subscriptionEvent.create({
        data: { subscriptionId: id, fromStatus, toStatus, reason, actorId },
      });
    });
    return (await this.findById(id)) as SubscriptionRecord;
  }

  async renew(
    id: string,
    fromStatus: SubscriptionStatus,
    previousExpiresAt: Date | null,
    periodStartsAt: Date,
    periodEndsAt: Date,
    actorId: string,
    snapshot: {
      amount: string;
      currency: string;
      billingInterval: SubscriptionRecord['billingInterval'];
    },
    reason?: string,
  ): Promise<SubscriptionRenewalResult> {
    const renewal = await this.prisma.$transaction(async (transaction) => {
      const result = await transaction.subscription.updateMany({
        where: { id, status: fromStatus, expiresAt: previousExpiresAt },
        data: {
          status: 'ACTIVE',
          renewsAt: periodEndsAt,
          expiresAt: periodEndsAt,
          graceEndsAt: null,
          suspendedAt: null,
          cancelledAt: null,
        },
      });
      if (result.count !== 1) {
        throw new ConflictError(
          'The subscription was already renewed or changed. Refresh and review its current expiry.',
          'SUBSCRIPTION_CONCURRENT_CHANGE',
        );
      }
      const created = await transaction.subscriptionRenewal.create({
        data: {
          subscriptionId: id,
          previousExpiresAt,
          periodStartsAt,
          periodEndsAt,
          amount: snapshot.amount,
          currency: snapshot.currency,
          billingInterval: snapshot.billingInterval,
          reason,
          createdById: actorId,
        },
        include: {
          createdBy: { select: { id: true, displayName: true } },
        },
      });
      await transaction.subscriptionEvent.create({
        data: {
          subscriptionId: id,
          fromStatus,
          toStatus: 'ACTIVE',
          reason: reason ?? 'Subscription renewed',
          actorId,
          metadata: {
            originalStartsAtPreserved: true,
            previousExpiresAt,
            periodStartsAt,
            periodEndsAt,
            renewalId: created.id,
          },
        },
      });
      return created;
    });
    return {
      subscription: (await this.findById(id)) as SubscriptionRecord,
      renewal: this.mapRenewal(renewal),
    };
  }

  async events(id: string): Promise<SubscriptionEventRecord[]> {
    return this.prisma.subscriptionEvent.findMany({
      where: { subscriptionId: id },
      select: {
        id: true,
        subscriptionId: true,
        fromStatus: true,
        toStatus: true,
        reason: true,
        createdAt: true,
        actor: { select: { id: true, displayName: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async renewals(id: string): Promise<SubscriptionRenewalRecord[]> {
    const rows = await this.prisma.subscriptionRenewal.findMany({
      where: { subscriptionId: id },
      include: {
        createdBy: { select: { id: true, displayName: true } },
      },
      orderBy: [{ periodStartsAt: 'desc' }, { createdAt: 'desc' }],
    });
    return rows.map((row) => this.mapRenewal(row));
  }

  async softDelete(
    id: string,
    actorId: string,
    deletedAt: Date,
  ): Promise<void> {
    await this.prisma.$transaction(async (transaction) => {
      const devices = await transaction.device.findMany({
        where: { subscriptionId: id },
        select: { id: true },
      });
      await transaction.licenseLease.updateMany({
        where: { subscriptionId: id, status: 'ACTIVE' },
        data: { status: 'REVOKED', revokedAt: deletedAt },
      });
      for (const device of devices) {
        await transaction.device.update({
          where: { id: device.id },
          data: {
            installationId: `DELETED-${device.id}`,
            status: 'REVOKED',
            revokedAt: deletedAt,
          },
        });
      }
      const deleted = await transaction.subscription.updateMany({
        where: { id, deletedAt: null },
        data: {
          status: 'CANCELLED',
          cancelledAt: deletedAt,
          deletedAt,
          deletedById: actorId,
        },
      });
      if (deleted.count !== 1) {
        throw new Error('SUBSCRIPTION_CONCURRENT_DELETE');
      }
    });
  }

  private map(subscription: SubscriptionWithRelations): SubscriptionRecord {
    const { devices, ...record } = subscription;
    return {
      ...record,
      amount: subscription.amount.toFixed(2),
      entitlements: subscription.entitlements as Record<string, unknown>,
      planVersion: {
        ...subscription.planVersion,
        features: subscription.planVersion.features as Record<string, unknown>,
      },
      device: devices[0] ?? null,
    };
  }

  private mapRenewal(renewal: {
    id: string;
    subscriptionId: string;
    previousExpiresAt: Date | null;
    periodStartsAt: Date;
    periodEndsAt: Date;
    amount: { toFixed(digits: number): string };
    currency: string;
    billingInterval: SubscriptionRecord['billingInterval'];
    reason: string | null;
    createdById: string;
    createdBy: { id: string; displayName: string };
    createdAt: Date;
  }): SubscriptionRenewalRecord {
    return { ...renewal, amount: renewal.amount.toFixed(2) };
  }

  private legacyDeviceId(notes: string | null): string | null {
    const match = notes?.match(/^Legacy device ID:\s*(.+)$/im);
    return match?.[1]?.trim().toUpperCase() || null;
  }

  private rethrowDeviceConflict(error: unknown): never {
    const errorCode =
      typeof error === 'object' && error !== null && 'code' in error
        ? (error as { code?: unknown }).code
        : null;
    if (errorCode === 'P2002') {
      throw new ConflictError(
        'Device ID is already assigned to another subscription.',
        'DEVICE_ALREADY_ASSIGNED',
      );
    }
    throw error;
  }
}
