import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import test from 'node:test';
import { isPathInside, safeRemove } from './platform-backup-lib.mjs';

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
