import {
  Injectable,
  OnModuleDestroy,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import { existsSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import { PrismaClient as StorePrismaClient } from '../../generated/store-prisma/client.js';
import { PrismaService } from '../database/prisma.service.js';

interface CachedClient {
  client: StorePrismaClient;
  lastUsedAt: number;
  activeRequests: number;
}

@Injectable()
export class StorePrismaClientFactory implements OnModuleDestroy {
  private readonly root: string;
  private readonly maximumClients: number;
  private readonly idleMilliseconds: number;
  private readonly clients = new Map<string, CachedClient>();
  private readonly creating = new Map<string, Promise<CachedClient>>();

  constructor(
    private readonly prisma: PrismaService,
    config: ConfigService,
  ) {
    this.root = resolve(config.get<string>('STORE_SNAPSHOT_ROOT', './data'));
    this.maximumClients = config.get<number>('STORE_CLIENT_CACHE_MAX', 25);
    this.idleMilliseconds = config.get<number>(
      'STORE_CLIENT_IDLE_MILLISECONDS',
      10 * 60_000,
    );
  }

  async withClient<T>(
    storeId: string,
    operation: (client: StorePrismaClient) => Promise<T>,
  ): Promise<{
    snapshot: {
      id: string;
      schemaVersion: number;
      snapshotCreatedAt: Date;
      syncedAt: Date | null;
    };
    data: T;
  }> {
    const store = await this.prisma.store.findUnique({
      where: { id: storeId },
      select: { activeSnapshot: true },
    });
    const snapshot = store?.activeSnapshot;
    if (!snapshot || snapshot.status !== 'ACTIVE') {
      throw new ServiceUnavailableException({
        code: 'STORE_NOT_SYNCED',
        message: 'This store does not have a synchronized database yet.',
      });
    }
    const key = `${storeId}:${snapshot.id}`;
    const entry = await this.acquire(
      key,
      storeId,
      snapshot.id,
      snapshot.fileName,
    );
    entry.activeRequests += 1;
    entry.lastUsedAt = Date.now();
    try {
      return {
        snapshot: {
          id: snapshot.id,
          schemaVersion: snapshot.schemaVersion,
          snapshotCreatedAt: snapshot.snapshotCreatedAt,
          syncedAt: snapshot.activatedAt,
        },
        data: await operation(entry.client),
      };
    } finally {
      entry.activeRequests -= 1;
      entry.lastUsedAt = Date.now();
      await this.evict();
    }
  }

  async onModuleDestroy(): Promise<void> {
    await Promise.all(
      [...this.clients.values()].map((entry) => entry.client.$disconnect()),
    );
    this.clients.clear();
  }

  async releaseSnapshot(storeId: string, snapshotId: string): Promise<boolean> {
    const key = `${storeId}:${snapshotId}`;
    const pending = this.creating.get(key);
    if (pending) await pending;
    const entry = this.clients.get(key);
    if (!entry) return true;
    if (entry.activeRequests > 0) return false;
    this.clients.delete(key);
    await entry.client.$disconnect();
    return true;
  }

  private async acquire(
    key: string,
    storeId: string,
    snapshotId: string,
    fileName: string,
  ): Promise<CachedClient> {
    const cached = this.clients.get(key);
    if (cached) return cached;
    const pending = this.creating.get(key);
    if (pending) return pending;
    const creation = this.createClient(storeId, snapshotId, fileName);
    this.creating.set(key, creation);
    try {
      const entry = await creation;
      this.clients.set(key, entry);
      return entry;
    } finally {
      this.creating.delete(key);
    }
  }

  private async createClient(
    storeId: string,
    snapshotId: string,
    fileName: string,
  ): Promise<CachedClient> {
    const path = this.snapshotPath(storeId, snapshotId, fileName);
    if (!existsSync(path)) {
      throw new ServiceUnavailableException({
        code: 'SNAPSHOT_FILE_MISSING',
        message: 'The synchronized store database is unavailable.',
      });
    }
    const adapter = new PrismaBetterSqlite3({
      url: path,
      readonly: true,
      fileMustExist: true,
    });
    const client = new StorePrismaClient({ adapter });
    await client.$connect();
    return { client, lastUsedAt: Date.now(), activeRequests: 0 };
  }

  private snapshotPath(
    storeId: string,
    snapshotId: string,
    fileName: string,
  ): string {
    if (fileName !== `${snapshotId}.sqlite`) {
      throw new ServiceUnavailableException('Snapshot metadata is invalid.');
    }
    const path = resolve(this.root, 'stores', storeId, 'snapshots', fileName);
    if (!path.startsWith(`${this.root}${sep}`)) {
      throw new ServiceUnavailableException('Snapshot path is invalid.');
    }
    return path;
  }

  private async evict(): Promise<void> {
    const now = Date.now();
    const candidates = [...this.clients.entries()]
      .filter(([, entry]) => entry.activeRequests === 0)
      .sort((left, right) => left[1].lastUsedAt - right[1].lastUsedAt);
    for (const [key, entry] of candidates) {
      const expired = now - entry.lastUsedAt >= this.idleMilliseconds;
      const overLimit = this.clients.size > this.maximumClients;
      if (!expired && !overLimit) break;
      this.clients.delete(key);
      await entry.client.$disconnect();
    }
  }
}
