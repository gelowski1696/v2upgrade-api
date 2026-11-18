import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'node:crypto';
import type { AuthenticatedDevice } from '../../domain/device/device-auth.types.js';
import { cloudMasterDataEnabled } from '../../domain/subscriptions/feature-mods.js';
import { PrismaService } from '../../infrastructure/database/prisma.service.js';

const ACKNOWLEDGEMENT_STATUSES = [
  'DOWNLOADED',
  'VALIDATED',
  'REJECTED',
] as const;
const ACTIVE_SUBSCRIPTION_STATUSES = ['TRIAL', 'ACTIVE', 'GRACE'] as const;
export type MasterDataAcknowledgementStatus =
  (typeof ACKNOWLEDGEMENT_STATUSES)[number];

@Injectable()
export class MasterDataDeliveryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async current(device: AuthenticatedDevice) {
    await this.requireCloudMasterData(device);
    const release = await this.latestPublished(device.clientId);
    if (!release) {
      return {
        available: false,
        storeId: device.storeId,
        message: 'No published master-data release is available.',
      };
    }
    return {
      available: true,
      storeId: device.storeId,
      release: this.manifest(release, release.entries),
    };
  }

  async download(device: AuthenticatedDevice, releaseId: string) {
    await this.requireCloudMasterData(device);
    const release = await this.prisma.masterDataRelease.findFirst({
      where: {
        id: releaseId,
        clientId: device.clientId,
        status: 'PUBLISHED',
      },
      include: {
        entries: {
          orderBy: [{ entityType: 'asc' }, { stableKey: 'asc' }],
          select: {
            entityType: true,
            operation: true,
            stableKey: true,
            payload: true,
          },
        },
        _count: { select: { entries: true } },
      },
    });
    if (!release || !release.releaseHash) {
      throw new NotFoundException('Published master-data release was not found.');
    }
    return {
      schemaVersion: 1,
      tenantId: device.clientId,
      storeId: device.storeId,
      release: this.manifest(release, release.entries),
      entries: release.entries,
    };
  }

  async acknowledge(
    device: AuthenticatedDevice,
    releaseId: string,
    input: {
      status: MasterDataAcknowledgementStatus;
      applicationVersion?: string;
      errorCode?: string;
    },
  ) {
    await this.requireCloudMasterData(device);
    if (!ACKNOWLEDGEMENT_STATUSES.includes(input.status)) {
      throw new BadRequestException('Acknowledgement status is not supported.');
    }
    const release = await this.prisma.masterDataRelease.findFirst({
      where: { id: releaseId, clientId: device.clientId, status: 'PUBLISHED' },
      select: { id: true, version: true },
    });
    if (!release) {
      throw new NotFoundException('Published master-data release was not found.');
    }
    const acknowledgedAt = new Date();
    const acknowledgement = await this.prisma.$transaction(
      async (transaction) => {
        const saved = await transaction.masterDataDeviceAcknowledgement.upsert({
          where: {
            deviceId_releaseId: { deviceId: device.id, releaseId },
          },
          create: {
            deviceId: device.id,
            releaseId,
            status: input.status,
            applicationVersion: input.applicationVersion?.trim() || null,
            errorCode: input.errorCode?.trim() || null,
            acknowledgedAt,
          },
          update: {
            status: input.status,
            applicationVersion: input.applicationVersion?.trim() || null,
            errorCode: input.errorCode?.trim() || null,
            acknowledgedAt,
          },
        });
        await transaction.auditLog.create({
          data: {
            action: 'master_data.device_acknowledged',
            resourceType: 'master_data_release',
            resourceId: releaseId,
            metadata: {
              deviceId: device.id,
              storeId: device.storeId,
              version: release.version,
              status: input.status,
              errorCode: input.errorCode?.trim() || undefined,
            },
          },
        });
        return saved;
      },
    );
    return {
      releaseId,
      version: release.version,
      status: acknowledgement.status,
      acknowledgedAt: acknowledgement.acknowledgedAt,
    };
  }

  private latestPublished(clientId: string) {
    return this.prisma.masterDataRelease.findFirst({
      where: { clientId, status: 'PUBLISHED' },
      orderBy: { version: 'desc' },
      include: {
        entries: {
          orderBy: [{ entityType: 'asc' }, { stableKey: 'asc' }],
          select: {
            entityType: true,
            operation: true,
            stableKey: true,
            payload: true,
          },
        },
        _count: { select: { entries: true } },
      },
    });
  }

  private async requireCloudMasterData(
    device: AuthenticatedDevice,
  ): Promise<void> {
    const record = await this.prisma.device.findFirst({
      where: {
        id: device.id,
        clientId: device.clientId,
        storeId: device.storeId,
        status: 'ACTIVE',
        subscription: {
          deletedAt: null,
          status: { in: [...ACTIVE_SUBSCRIPTION_STATUSES] },
        },
      },
      select: { subscription: { select: { entitlements: true } } },
    });
    if (
      !record?.subscription ||
      !cloudMasterDataEnabled(record.subscription.entitlements)
    ) {
      throw new ForbiddenException(
        'Cloud-managed master data is not enabled for this device.',
      );
    }
  }

  private manifest(release: {
    id: string;
    version: number;
    releaseHash: string | null;
    notes: string | null;
    publishedAt: Date | null;
    _count: { entries: number };
  }, entries: unknown[]) {
    return {
      id: release.id,
      version: release.version,
      releaseHash: release.releaseHash,
      contentHash: this.contentHash(entries),
      notes: release.notes,
      publishedAt: release.publishedAt,
      entryCount: release._count.entries,
      minimumApplicationVersion: this.config.get<string>(
        'MASTER_DATA_MIN_APP_VERSION',
        '0.2.9',
      ),
      downloadPath: `/master-data/releases/${release.id}/download`,
    };
  }

  private contentHash(entries: unknown[]): string {
    return createHash('sha256')
      .update(JSON.stringify(this.canonicalValue(entries)))
      .digest('hex');
  }

  private canonicalValue(value: unknown): unknown {
    if (Array.isArray(value)) {
      return value.map((entry) => this.canonicalValue(entry));
    }
    if (value && typeof value === 'object') {
      return Object.fromEntries(
        Object.entries(value as Record<string, unknown>)
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([key, entry]) => [key, this.canonicalValue(entry)]),
      );
    }
    return value;
  }
}
