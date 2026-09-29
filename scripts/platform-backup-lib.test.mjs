import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import test from 'node:test';
import {
  isPathInside,
  postgresToolDatabaseUrl,
  safeRemove,
} from './platform-backup-lib.mjs';

test('removes Prisma-only parameters from PostgreSQL tool URLs', () => {
  const result = postgresToolDatabaseUrl(
    'postgresql://posv2:p%40ss@postgres:5432/app?schema=public&connection_limit=10&pool_timeout=5&pgbouncer=true&socket_timeout=30&sslmode=require&connect_timeout=8',
  );
  const url = new URL(result);

  assert.equal(url.username, 'posv2');
  assert.equal(url.password, 'p%40ss');
  assert.equal(url.pathname, '/app');
  assert.equal(url.searchParams.has('schema'), false);
  assert.equal(url.searchParams.has('connection_limit'), false);
  assert.equal(url.searchParams.has('pool_timeout'), false);
  assert.equal(url.searchParams.has('pgbouncer'), false);
  assert.equal(url.searchParams.has('socket_timeout'), false);
  assert.equal(url.searchParams.get('sslmode'), 'require');
  assert.equal(url.searchParams.get('connect_timeout'), '8');
});

test('recognizes child paths on the current operating system', () => {
  const parent = join(tmpdir(), 'posv2-backups');

  assert.equal(isPathInside(join(parent, '.staging-123'), parent), true);
  assert.equal(isPathInside(parent, parent), false);
  assert.equal(isPathInside(dirname(parent), parent), false);
  assert.equal(
    isPathInside(join(dirname(parent), `${basename(parent)}-other`), parent),
    false,
  );
});

test('safeRemove deletes a child but refuses its parent', async (context) => {
  const parent = await fs.mkdtemp(join(tmpdir(), 'posv2-backup-remove-'));
  const child = join(parent, '.staging-test');
  context.after(() => fs.rm(parent, { recursive: true, force: true }));
  await fs.mkdir(child);

  await safeRemove(child, parent);

  await assert.rejects(() => fs.access(child));
  await assert.rejects(
    () => safeRemove(parent, parent),
    /Refusing to remove path outside backup root/,
  );
});
