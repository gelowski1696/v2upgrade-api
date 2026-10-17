import { ConfigService } from '@nestjs/config';
import { jest } from '@jest/globals';
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { gzipSync } from 'node:zlib';
import type { AuthenticatedDevice } from '../../domain/device/device-auth.types.js';
import { PrismaService } from '../../infrastructure/database/prisma.service.js';
import { StorePrismaClientFactory } from '../../infrastructure/store-database/store-prisma-client.factory.js';
import { DeviceSyncService } from './device-sync.service.js';

describe('DeviceSyncService compressed uploads', () => {
  it('decompresses gzip uploads and verifies the original SQLite bytes', async () => {
    const root = await fs.mkdtemp(join(tmpdir(), 'vmjam-device-sync-'));
    const device: AuthenticatedDevice = {
      id: '11111111-1111-4111-8111-111111111111',
      clientId: '22222222-2222-4222-8222-222222222222',
      storeId: '33333333-3333-4333-8333-333333333333',
      installationId: 'installation-1',
    };
    const sessionId = '44444444-4444-4444-8444-444444444444';
    const snapshot = Buffer.from('SQLite format test payload'.repeat(16_384));
    const compressed = gzipSync(snapshot, { level: 1 });
    const session = {
      id: sessionId,
      storeId: device.storeId,
      deviceId: device.id,
      expectedSize: BigInt(snapshot.length),
      expectedSha256: createHash('sha256').update(snapshot).digest('hex'),
      schemaVersion: 31,
      applicationVersion: '0.1.1',
      snapshotCreatedAt: new Date(),
      status: 'CREATED',
      expiresAt: new Date(Date.now() + 60_000),
      receivedBytes: 0n,
      snapshotId: null,
      rejectionCode: null,
      rejectionMessage: null,
      createdAt: new Date(),
      completedAt: null,
    };
    const prisma = {
      syncUploadSession: {
        findFirst: jest.fn(() => Promise.resolve(session)),
        update: jest.fn(({ data }: { data: Record<string, unknown> }) =>
          Promise.resolve({ ...session, ...data }),
        ),
      },
    } as unknown as PrismaService;
    const service = new DeviceSyncService(
      prisma,
      {} as StorePrismaClientFactory,
      new ConfigService({
        STORE_SNAPSHOT_ROOT: root,
        STORE_SNAPSHOT_MAX_BYTES: 10 * 1024 * 1024,
        STORE_SCHEMA_MIN_VERSION: 27,
        STORE_SCHEMA_MAX_VERSION: 31,
      }),
    );

    try {
      const result = await service.upload(
        device,
        sessionId,
        Readable.from(compressed),
        compressed.length,
        'gzip',
      );

      expect(result.status).toBe('UPLOADED');
      expect(result.receivedBytes).toBe(snapshot.length);
      const staged = await fs.readFile(
        join(root, 'stores', device.storeId, 'staging', `${sessionId}.upload`),
      );
      expect(staged).toEqual(snapshot);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
