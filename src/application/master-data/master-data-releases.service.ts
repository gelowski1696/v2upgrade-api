import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import { PrismaService } from '../../infrastructure/database/prisma.service.js';
import type { Prisma } from '../../generated/prisma/client.js';

export type MasterDataEntityType =
  'CATEGORY' | 'BRAND' | 'CYLINDER_SIZE' | 'PRODUCT' | 'SUPPLIER' | 'PRICE';
export type MasterDataChangeOperation = 'UPSERT' | 'DEACTIVATE';

export interface MasterDataReleaseEntryInput {
  entityType: MasterDataEntityType;
  operation: MasterDataChangeOperation;
  stableKey: string;
  payload: Record<string, unknown>;
}

export interface CreateMasterDataReleaseInput {
  entries: MasterDataReleaseEntryInput[];
  notes?: string;
}

const ACTIVE_SUBSCRIPTION_STATUSES = ['TRIAL', 'ACTIVE', 'GRACE'] as const;

@Injectable()
export class MasterDataReleasesService {
  constructor(private readonly prisma: PrismaService) {}

  async list(clientId: string) {
    return this.prisma.masterDataRelease.findMany({
      where: { clientId },
      orderBy: { version: 'desc' },
      select: {
        id: true,
        clientId: true,
        version: true,
        status: true,
        releaseHash: true,
        notes: true,
        createdById: true,
        publishedAt: true,
        rolledBackAt: true,
        createdAt: true,
        _count: { select: { entries: true } },
      },
    });
  }

  async get(clientId: string, releaseId: string) {
    const release = await this.prisma.masterDataRelease.findFirst({
      where: { id: releaseId, clientId },
      include: {
        entries: { orderBy: [{ entityType: 'asc' }, { stableKey: 'asc' }] },
      },
    });
    if (!release)
      throw new NotFoundException('Master data release was not found.');
    return release;
  }

  async createDraft(
    clientId: string,
    input: CreateMasterDataReleaseInput,
    actorId: string,
  ) {
    const entries = this.normalizeEntries(input.entries);
    return this.prisma.$transaction(async (transaction) => {
      const client = await transaction.client.findUnique({
        where: { id: clientId },
        select: { id: true, status: true },
      });
      if (!client) throw new NotFoundException('Client was not found.');
      if (client.status !== 'ACTIVE') {
        throw new BadRequestException('Master data requires an active client.');
      }
      const subscription = await transaction.subscription.findFirst({
        where: {
          clientId,
          deletedAt: null,
          status: { in: [...ACTIVE_SUBSCRIPTION_STATUSES] },
        },
        select: { id: true },
      });
      if (!subscription) {
        throw new BadRequestException(
          'An active subscription is required before publishing master data.',
        );
      }
      // Serialize version allocation per tenant so concurrent admins cannot create
      // two drafts with the same next version.
      await transaction.$queryRaw`
        SELECT "id" FROM "clients" WHERE "id" = ${clientId}::uuid FOR UPDATE
      `;
      const result = await transaction.masterDataRelease.aggregate({
        where: { clientId },
        _max: { version: true },
      });
      const version = (result._max.version ?? 0) + 1;
      const release = await transaction.masterDataRelease.create({
        data: {
          clientId,
          version,
          status: 'DRAFT',
          notes: input.notes?.trim() || null,
          createdById: actorId,
          entries: {
            create: entries.map((entry) => ({
              entityType: entry.entityType,
              operation: entry.operation,
              stableKey: entry.stableKey,
              payload: entry.payload as Prisma.InputJsonObject,
            })),
          },
        },
        include: { entries: true },
      });
      await transaction.auditLog.create({
        data: {
          actorId,
          action: 'master_data.release_created',
          resourceType: 'master_data_release',
          resourceId: release.id,
          metadata: { clientId, version, entryCount: entries.length },
        },
      });
      return release;
    });
  }

  async publish(clientId: string, releaseId: string, actorId: string) {
    return this.prisma.$transaction(async (transaction) => {
      const release = await transaction.masterDataRelease.findFirst({
        where: { id: releaseId, clientId },
        include: { entries: true },
      });
      if (!release)
        throw new NotFoundException('Master data release was not found.');
      if (release.status !== 'DRAFT') {
        throw new ConflictException('Only a draft release can be published.');
      }
      const releaseHash = this.hashEntries(release.entries);
      const published = await transaction.masterDataRelease.update({
        where: { id: releaseId },
        data: { status: 'PUBLISHED', releaseHash, publishedAt: new Date() },
        include: { entries: true },
      });
      await transaction.auditLog.create({
        data: {
          actorId,
          action: 'master_data.release_published',
          resourceType: 'master_data_release',
          resourceId: releaseId,
          metadata: { clientId, version: release.version, releaseHash },
        },
      });
      return published;
    });
  }

  async rollback(clientId: string, releaseId: string, actorId: string) {
    return this.prisma.$transaction(async (transaction) => {
      const release = await transaction.masterDataRelease.findFirst({
        where: { id: releaseId, clientId },
      });
      if (!release)
        throw new NotFoundException('Master data release was not found.');
      if (release.status !== 'PUBLISHED') {
        throw new ConflictException(
          'Only a published release can be rolled back.',
        );
      }
      const updated = await transaction.masterDataRelease.update({
        where: { id: releaseId },
        data: { status: 'ROLLED_BACK', rolledBackAt: new Date() },
      });
      await transaction.auditLog.create({
        data: {
          actorId,
          action: 'master_data.release_rolled_back',
          resourceType: 'master_data_release',
          resourceId: releaseId,
          metadata: { clientId, version: release.version },
        },
      });
      return updated;
    });
  }

  private normalizeEntries(entries: MasterDataReleaseEntryInput[]) {
    if (!entries.length || entries.length > 10_000) {
      throw new BadRequestException(
        'A release must contain between 1 and 10,000 entries.',
      );
    }
    const keys = new Set<string>();
    return entries.map((entry) => {
      const stableKey = entry.stableKey.trim().toUpperCase();
      if (!stableKey || stableKey.length > 180) {
        throw new BadRequestException(
          'Each master-data entry needs a valid stable key.',
        );
      }
      const key = `${entry.entityType}:${stableKey}`;
      if (keys.has(key)) {
        throw new ConflictException(`Duplicate master-data entry: ${key}.`);
      }
      keys.add(key);
      return { ...entry, stableKey };
    });
  }

  private hashEntries(entries: Array<Record<string, unknown>>) {
    const canonical = entries
      .map((entry) => ({
        entityType: entry.entityType,
        operation: entry.operation,
        stableKey: entry.stableKey,
        payload: entry.payload,
      }))
      .sort((left, right) =>
        `${left.entityType}:${left.stableKey}`.localeCompare(
          `${right.entityType}:${right.stableKey}`,
        ),
      );
    return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
  }
}
