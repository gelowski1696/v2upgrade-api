import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
  PayloadTooLargeException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import BetterSqlite3 from 'better-sqlite3';
import { createHash } from 'node:crypto';
import { createWriteStream, promises as fs } from 'node:fs';
import { dirname, resolve, sep } from 'node:path';
import { once } from 'node:events';
import type { Readable } from 'node:stream';
import type { AuthenticatedDevice } from '../../domain/device/device-auth.types.js';
import { PrismaService } from '../../infrastructure/database/prisma.service.js';
import { StorePrismaClientFactory } from '../../infrastructure/store-database/store-prisma-client.factory.js';

interface CreateSessionInput {
  schemaVersion: number;
  applicationVersion: string;
  snapshotCreatedAt: string;
  fileSize: number;
  sha256: string;
}

@Injectable()
export class DeviceSyncService implements OnModuleInit {
  private readonly logger = new Logger(DeviceSyncService.name);
  private readonly root: string;
  private readonly maximumBytes: number;
  private readonly minimumSchema: number;
  private readonly maximumSchema: number;
  private readonly retainedPreviousSnapshots: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly storeClients: StorePrismaClientFactory,
    config: ConfigService,
  ) {
    this.root = resolve(config.get<string>('STORE_SNAPSHOT_ROOT', './data'));
    this.maximumBytes = config.get<number>(
      'STORE_SNAPSHOT_MAX_BYTES',
      512 * 1024 * 1024,
    );
    this.minimumSchema = config.get<number>('STORE_SCHEMA_MIN_VERSION', 27);
    this.maximumSchema = config.get<number>('STORE_SCHEMA_MAX_VERSION', 27);
    this.retainedPreviousSnapshots = Math.max(
      0,
      Math.trunc(config.get<number>('STORE_SNAPSHOT_RETAIN_PREVIOUS', 2)),
    );
  }

  async onModuleInit(): Promise<void> {
    await fs.mkdir(this.root, { recursive: true });
    await this.cleanupExpiredUploads();
    await this.cleanupAllRetiredSnapshots();
  }

  async createSession(device: AuthenticatedDevice, input: CreateSessionInput) {
    if (input.fileSize > this.maximumBytes) {
      throw new PayloadTooLargeException('Snapshot exceeds the upload limit.');
    }
    if (
      input.schemaVersion < this.minimumSchema ||
      input.schemaVersion > this.maximumSchema
    ) {
      throw new UnprocessableEntityException({
        code: 'SCHEMA_INCOMPATIBLE',
        message: `Supported schema versions are ${this.minimumSchema}-${this.maximumSchema}.`,
      });
    }

    const duplicate = await this.prisma.storeSnapshot.findUnique({
      where: {
        storeId_sha256: {
          storeId: device.storeId,
          sha256: input.sha256.toLowerCase(),
        },
      },
    });
    if (duplicate?.status === 'ACTIVE' || duplicate?.status === 'READY') {
      return {
        duplicate: true,
        snapshotId: duplicate.id,
        status: duplicate.status,
      };
    }

    const session = await this.prisma.syncUploadSession.create({
      data: {
        storeId: device.storeId,
        deviceId: device.id,
        expectedSize: BigInt(input.fileSize),
        expectedSha256: input.sha256.toLowerCase(),
        schemaVersion: input.schemaVersion,
        applicationVersion: input.applicationVersion.trim(),
        snapshotCreatedAt: new Date(input.snapshotCreatedAt),
        expiresAt: new Date(Date.now() + 30 * 60_000),
      },
    });
    await fs.mkdir(dirname(this.stagingPath(device.storeId, session.id)), {
      recursive: true,
    });
    return this.serializeSession(session);
  }

  async upload(
    device: AuthenticatedDevice,
    sessionId: string,
    stream: Readable,
    contentLength?: number,
  ) {
    const session = await this.getOwnedSession(device, sessionId);
    if (!['CREATED', 'UPLOADING'].includes(session.status)) {
      throw new ConflictException('This upload session is not writable.');
    }
    if (session.expiresAt <= new Date()) {
      await this.prisma.syncUploadSession.update({
        where: { id: session.id },
        data: { status: 'EXPIRED' },
      });
      throw new ConflictException('Upload session has expired.');
    }
    const expected = Number(session.expectedSize);
    if (contentLength && contentLength !== expected) {
      throw new UnprocessableEntityException('Upload size does not match.');
    }

    const path = this.stagingPath(device.storeId, session.id);
    await fs.mkdir(dirname(path), { recursive: true });
    const output = createWriteStream(path, { flags: 'w' });
    const hash = createHash('sha256');
    let received = 0;
    await this.prisma.syncUploadSession.update({
      where: { id: session.id },
      data: { status: 'UPLOADING', receivedBytes: 0 },
    });

    try {
      for await (const value of stream) {
        const chunk = Buffer.isBuffer(value)
          ? value
          : Buffer.from(value as Uint8Array);
        received += chunk.length;
        if (received > expected || received > this.maximumBytes) {
          throw new PayloadTooLargeException(
            'Upload exceeds its declared size.',
          );
        }
        hash.update(chunk);
        if (!output.write(chunk)) await once(output, 'drain');
      }
      output.end();
      await once(output, 'finish');
    } catch (error) {
      output.destroy();
      await fs.rm(path, { force: true });
      await this.rejectSession(
        session.id,
        'UPLOAD_INTERRUPTED',
        'Upload did not complete.',
      );
      throw error;
    }

    const actualHash = hash.digest('hex');
    if (received !== expected || actualHash !== session.expectedSha256) {
      await fs.rm(path, { force: true });
      await this.rejectSession(
        session.id,
        received !== expected ? 'SIZE_MISMATCH' : 'HASH_MISMATCH',
        'Uploaded database did not match the declared file.',
      );
      throw new UnprocessableEntityException(
        'Uploaded database verification failed.',
      );
    }
    const updated = await this.prisma.syncUploadSession.update({
      where: { id: session.id },
      data: { status: 'UPLOADED', receivedBytes: BigInt(received) },
    });
    return this.serializeSession(updated);
  }

  async complete(device: AuthenticatedDevice, sessionId: string) {
    const session = await this.getOwnedSession(device, sessionId);
    if (session.status === 'COMPLETE') return this.serializeSession(session);
    if (session.status !== 'UPLOADED') {
      throw new ConflictException('Upload must finish before validation.');
    }
    await this.prisma.syncUploadSession.update({
      where: { id: session.id },
      data: { status: 'VALIDATING' },
    });
    const staged = this.stagingPath(device.storeId, session.id);
    try {
      this.validateSnapshot(staged, session.schemaVersion);
      const existing = await this.prisma.storeSnapshot.findUnique({
        where: {
          storeId_sha256: {
            storeId: device.storeId,
            sha256: session.expectedSha256,
          },
        },
      });
      if (existing) {
        await fs.rm(staged, { force: true });
        const completed = await this.prisma.syncUploadSession.update({
          where: { id: session.id },
          data: {
            status: 'COMPLETE',
            snapshotId: existing.id,
            completedAt: new Date(),
          },
        });
        try {
          await this.cleanupRetiredSnapshots(device.storeId);
        } catch (error) {
          this.logger.warn(
            `Snapshot retention cleanup failed for store ${device.storeId}: ${this.errorMessage(error)}`,
          );
        }
        return this.serializeSession(completed);
      }

      const snapshotId = crypto.randomUUID();
      const finalPath = this.snapshotPath(device.storeId, snapshotId);
      await fs.mkdir(dirname(finalPath), { recursive: true });
      await fs.rename(staged, finalPath);
      try {
        const completed = await this.prisma.$transaction(
          async (transaction) => {
            const currentStore = await transaction.store.findUniqueOrThrow({
              where: { id: device.storeId },
              select: { activeSnapshotId: true },
            });
            const snapshot = await transaction.storeSnapshot.create({
              data: {
                id: snapshotId,
                storeId: device.storeId,
                deviceId: device.id,
                schemaVersion: session.schemaVersion,
                applicationVersion: session.applicationVersion,
                fileName: `${snapshotId}.sqlite`,
                fileSize: session.expectedSize,
                sha256: session.expectedSha256,
                status: 'ACTIVE',
                snapshotCreatedAt: session.snapshotCreatedAt,
                activatedAt: new Date(),
              },
            });
            if (currentStore.activeSnapshotId) {
              await transaction.storeSnapshot.update({
                where: { id: currentStore.activeSnapshotId },
                data: { status: 'RETIRED' },
              });
            }
            await transaction.store.update({
              where: { id: device.storeId },
              data: { activeSnapshotId: snapshot.id },
            });
            await transaction.auditLog.create({
              data: {
                action: 'sync.snapshot_activated',
                resourceType: 'store_snapshot',
                resourceId: snapshot.id,
                metadata: {
                  deviceId: device.id,
                  storeId: device.storeId,
                  schemaVersion: session.schemaVersion,
                  fileSize: session.expectedSize.toString(),
                  sha256: session.expectedSha256,
                },
              },
            });
            return transaction.syncUploadSession.update({
              where: { id: session.id },
              data: {
                status: 'COMPLETE',
                snapshotId: snapshot.id,
                completedAt: new Date(),
              },
            });
          },
        );
        try {
          await this.cleanupRetiredSnapshots(device.storeId);
        } catch (error) {
          this.logger.warn(
            `Snapshot retention cleanup failed for store ${device.storeId}: ${this.errorMessage(error)}`,
          );
        }
        return this.serializeSession(completed);
      } catch (error) {
        await fs.rm(finalPath, { force: true });
        throw error;
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Snapshot validation failed.';
      await fs.rm(staged, { force: true });
      await this.rejectSession(session.id, 'SNAPSHOT_INVALID', message);
      if (error instanceof UnprocessableEntityException) throw error;
      throw new UnprocessableEntityException({
        code: 'SNAPSHOT_INVALID',
        message,
      });
    }
  }

  async status(device: AuthenticatedDevice, sessionId?: string) {
    if (sessionId) {
      return this.serializeSession(
        await this.getOwnedSession(device, sessionId),
      );
    }
    const store = await this.prisma.store.findUniqueOrThrow({
      where: { id: device.storeId },
      include: { activeSnapshot: true },
    });
    return {
      storeId: store.id,
      storeName: store.name,
      activeSnapshot: store.activeSnapshot
        ? {
            id: store.activeSnapshot.id,
            schemaVersion: store.activeSnapshot.schemaVersion,
            snapshotCreatedAt: store.activeSnapshot.snapshotCreatedAt,
            syncedAt: store.activeSnapshot.activatedAt,
          }
        : null,
    };
  }

  async listSnapshots(device: AuthenticatedDevice) {
    const snapshots = await this.prisma.storeSnapshot.findMany({
      where: {
        storeId: device.storeId,
        status: { in: ['ACTIVE', 'RETIRED'] },
      },
      orderBy: [{ activatedAt: 'desc' }, { uploadedAt: 'desc' }],
    });
    return snapshots.map((snapshot) => this.serializeSnapshot(snapshot));
  }

  async reactivateSnapshot(device: AuthenticatedDevice, snapshotId: string) {
    const selected = await this.prisma.storeSnapshot.findFirst({
      where: { id: snapshotId, storeId: device.storeId },
    });
    if (!selected) throw new NotFoundException('Snapshot was not found.');
    if (selected.status === 'ACTIVE') return this.serializeSnapshot(selected);
    if (selected.status !== 'RETIRED') {
      throw new ConflictException('Only a retained snapshot can be restored.');
    }

    const path = this.snapshotPath(device.storeId, selected.id);
    try {
      await fs.access(path);
      this.validateSnapshot(path, selected.schemaVersion);
    } catch (error) {
      throw new UnprocessableEntityException({
        code: 'SNAPSHOT_UNAVAILABLE',
        message: `The retained database cannot be restored: ${this.errorMessage(error)}`,
      });
    }

    const restored = await this.prisma.$transaction(async (transaction) => {
      const store = await transaction.store.findUniqueOrThrow({
        where: { id: device.storeId },
        select: { activeSnapshotId: true },
      });
      if (store.activeSnapshotId) {
        await transaction.storeSnapshot.update({
          where: { id: store.activeSnapshotId },
          data: { status: 'RETIRED' },
        });
      }
      const active = await transaction.storeSnapshot.update({
        where: { id: selected.id },
        data: { status: 'ACTIVE', activatedAt: new Date() },
      });
      await transaction.store.update({
        where: { id: device.storeId },
        data: { activeSnapshotId: selected.id },
      });
      await transaction.auditLog.create({
        data: {
          action: 'sync.snapshot_restored',
          resourceType: 'store_snapshot',
          resourceId: selected.id,
          metadata: {
            deviceId: device.id,
            storeId: device.storeId,
            replacedSnapshotId: store.activeSnapshotId,
          },
        },
      });
      return active;
    });
    try {
      await this.cleanupRetiredSnapshots(device.storeId);
    } catch (error) {
      this.logger.warn(
        `Snapshot retention cleanup failed after restore for store ${device.storeId}: ${this.errorMessage(error)}`,
      );
    }
    return this.serializeSnapshot(restored);
  }

  async cancel(device: AuthenticatedDevice, sessionId: string): Promise<void> {
    const session = await this.getOwnedSession(device, sessionId);
    if (session.status === 'COMPLETE') {
      throw new ConflictException('A completed upload cannot be cancelled.');
    }
    await fs.rm(this.stagingPath(device.storeId, session.id), { force: true });
    await this.prisma.syncUploadSession.update({
      where: { id: session.id },
      data: { status: 'CANCELLED', completedAt: new Date() },
    });
  }

  private validateSnapshot(path: string, declaredVersion: number): void {
    const database = new BetterSqlite3(path, {
      readonly: true,
      fileMustExist: true,
    });
    try {
      const integrity = database.pragma('quick_check', { simple: true });
      if (String(integrity).toLowerCase() !== 'ok') {
        throw new Error(
          `Database integrity check returned ${String(integrity)}.`,
        );
      }
      const required = [
        'schema_migrations',
        'salestbl',
        'salescart',
        'inventorytbl',
        'custinfo',
        'pouttbl',
      ];
      const tables = new Set(
        (
          database
            .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
            .all() as Array<{ name: string }>
        ).map((row) => row.name),
      );
      const missing = required.filter((table) => !tables.has(table));
      if (missing.length)
        throw new Error(`Required tables are missing: ${missing.join(', ')}.`);
      const version = database
        .prepare('SELECT MAX(version) AS version FROM schema_migrations')
        .get() as { version?: number };
      if (version.version !== declaredVersion) {
        throw new Error('Declared schema version does not match the database.');
      }
      if (
        declaredVersion < this.minimumSchema ||
        declaredVersion > this.maximumSchema
      ) {
        throw new Error('Database schema is not supported by this server.');
      }
    } finally {
      database.close();
    }
  }

  private async getOwnedSession(device: AuthenticatedDevice, id: string) {
    const session = await this.prisma.syncUploadSession.findFirst({
      where: { id, deviceId: device.id, storeId: device.storeId },
    });
    if (!session) throw new NotFoundException('Upload session was not found.');
    return session;
  }

  private async rejectSession(id: string, code: string, message: string) {
    await this.prisma.syncUploadSession.update({
      where: { id },
      data: {
        status: 'REJECTED',
        rejectionCode: code,
        rejectionMessage: message,
        completedAt: new Date(),
      },
    });
    this.logger.warn(
      JSON.stringify({ event: 'sync.session_rejected', sessionId: id, code }),
    );
  }

  private async cleanupExpiredUploads(): Promise<void> {
    const expired = await this.prisma.syncUploadSession.findMany({
      where: {
        expiresAt: { lt: new Date() },
        status: { in: ['CREATED', 'UPLOADING', 'UPLOADED', 'VALIDATING'] },
      },
      select: { id: true, storeId: true },
    });
    for (const session of expired) {
      await fs.rm(this.stagingPath(session.storeId, session.id), {
        force: true,
      });
    }
    if (expired.length) {
      await this.prisma.syncUploadSession.updateMany({
        where: { id: { in: expired.map((session) => session.id) } },
        data: { status: 'EXPIRED', completedAt: new Date() },
      });
    }
  }

  private async cleanupAllRetiredSnapshots(): Promise<void> {
    const stores = await this.prisma.storeSnapshot.findMany({
      where: { status: 'RETIRED' },
      distinct: ['storeId'],
      select: { storeId: true },
    });
    for (const store of stores) {
      try {
        await this.cleanupRetiredSnapshots(store.storeId);
      } catch (error) {
        this.logger.warn(
          `Startup snapshot cleanup failed for store ${store.storeId}: ${this.errorMessage(error)}`,
        );
      }
    }
  }

  private async cleanupRetiredSnapshots(storeId: string): Promise<void> {
    const retired = await this.prisma.storeSnapshot.findMany({
      where: { storeId, status: 'RETIRED' },
      orderBy: [{ activatedAt: 'desc' }, { uploadedAt: 'desc' }],
    });
    const removable = retired.slice(this.retainedPreviousSnapshots);
    for (const snapshot of removable) {
      const released = await this.storeClients.releaseSnapshot(
        storeId,
        snapshot.id,
      );
      if (!released) continue;
      await fs.rm(this.snapshotPath(storeId, snapshot.id), { force: true });
      const deleted = await this.prisma.storeSnapshot.deleteMany({
        where: { id: snapshot.id, storeId, status: 'RETIRED' },
      });
      if (deleted.count) {
        await this.prisma.auditLog.create({
          data: {
            action: 'sync.snapshot_retention_deleted',
            resourceType: 'store_snapshot',
            resourceId: snapshot.id,
            metadata: { storeId, sha256: snapshot.sha256 },
          },
        });
      }
    }
  }

  private stagingPath(storeId: string, sessionId: string): string {
    return this.safePath('stores', storeId, 'staging', `${sessionId}.upload`);
  }

  private snapshotPath(storeId: string, snapshotId: string): string {
    return this.safePath(
      'stores',
      storeId,
      'snapshots',
      `${snapshotId}.sqlite`,
    );
  }

  private safePath(...parts: string[]): string {
    const path = resolve(this.root, ...parts);
    if (path !== this.root && !path.startsWith(`${this.root}${sep}`)) {
      throw new Error('Snapshot path is outside the configured storage root.');
    }
    return path;
  }

  private serializeSession(session: {
    id: string;
    storeId: string;
    status: string;
    expectedSize: bigint;
    receivedBytes: bigint;
    expiresAt: Date;
    snapshotId: string | null;
    rejectionCode: string | null;
    rejectionMessage: string | null;
    completedAt: Date | null;
  }) {
    return {
      id: session.id,
      storeId: session.storeId,
      status: session.status,
      expectedSize: Number(session.expectedSize),
      receivedBytes: Number(session.receivedBytes),
      expiresAt: session.expiresAt,
      snapshotId: session.snapshotId,
      rejectionCode: session.rejectionCode,
      rejectionMessage: session.rejectionMessage,
      completedAt: session.completedAt,
    };
  }

  private serializeSnapshot(snapshot: {
    id: string;
    status: string;
    schemaVersion: number;
    applicationVersion: string;
    fileSize: bigint;
    sha256: string;
    snapshotCreatedAt: Date;
    uploadedAt: Date;
    activatedAt: Date | null;
  }) {
    return {
      id: snapshot.id,
      status: snapshot.status,
      schemaVersion: snapshot.schemaVersion,
      applicationVersion: snapshot.applicationVersion,
      fileSize: Number(snapshot.fileSize),
      sha256: snapshot.sha256,
      snapshotCreatedAt: snapshot.snapshotCreatedAt,
      uploadedAt: snapshot.uploadedAt,
      activatedAt: snapshot.activatedAt,
    };
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}
