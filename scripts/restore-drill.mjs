import { promises as fs } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  backupRoot,
  databaseUrl,
  isPathInside,
  pool,
  readDashboardFingerprint,
  recordBackupOperation,
  runPostgresTool,
  sha256,
  temporaryDatabaseUrl,
} from './platform-backup-lib.mjs';

let temporary;
let admin;
let restored;

await recordBackupOperation('restoreDrill', 'RUNNING');
try {
  if (!databaseUrl) throw new Error('DATABASE_URL is required.');
  const backup = await selectBackup();
  const manifest = JSON.parse(
    await fs.readFile(join(backup, 'manifest.json'), 'utf8'),
  );
  temporary = temporaryDatabaseUrl();
  const adminUrl = new URL(databaseUrl);
  adminUrl.pathname = '/postgres';
  admin = pool(adminUrl.toString());
  await admin.query(`CREATE DATABASE "${temporary.name}"`);
  runPostgresTool('pg_restore', [
    `--dbname=${temporary.url}`,
    '--no-owner',
    '--no-privileges',
    '--exit-on-error',
    join(backup, manifest.database.dump),
  ]);
  restored = pool(temporary.url);
  const counts = await restored.query(`
    SELECT
      (SELECT COUNT(*)::int FROM clients) AS clients,
      (SELECT COUNT(*)::int FROM stores) AS stores,
      (SELECT COUNT(*)::int FROM portal_users) AS portal_users,
      (SELECT COUNT(*)::int FROM devices) AS devices,
      (SELECT COUNT(*)::int FROM store_snapshots) AS snapshots
  `);
  if (JSON.stringify(counts.rows[0]) !== JSON.stringify(manifest.database.counts)) {
    throw new Error(`Restored metadata counts differ: ${JSON.stringify(counts.rows[0])}`);
  }

  const activeRows = await restored.query(
    `SELECT id, store_id FROM store_snapshots WHERE status = 'ACTIVE' ORDER BY id`,
  );
  const activeManifest = manifest.snapshots.filter((snapshot) => snapshot.active);
  if (activeRows.rowCount !== activeManifest.length) {
    throw new Error('Restored active snapshot count differs from the backup manifest.');
  }
  for (const snapshot of manifest.snapshots) {
    const path = resolve(backup, snapshot.relativePath);
    if (!isPathInside(path, backup)) {
      throw new Error('Invalid snapshot path in manifest.');
    }
    const hash = await sha256(path);
    if (hash !== snapshot.sha256) {
      throw new Error(`Snapshot checksum failed: ${snapshot.id}`);
    }
    if (snapshot.active) {
      const actual = readDashboardFingerprint(path);
      if (JSON.stringify(actual) !== JSON.stringify(snapshot.dashboard)) {
        throw new Error(
          `Dashboard totals differ after restore for store ${snapshot.storeId}.`,
        );
      }
    }
  }
  await recordBackupOperation('restoreDrill', 'PASS');
  console.log(
    JSON.stringify(
      {
        result: 'PASS',
        backup,
        restoredDatabase: temporary.name,
        metadata: counts.rows[0],
        activeDashboardTotalsVerified: activeManifest.length,
      },
      null,
      2,
    ),
  );
} catch (error) {
  await recordBackupOperation('restoreDrill', 'FAIL', error).catch(() => undefined);
  throw error;
} finally {
  if (restored) await restored.end();
  if (admin && temporary) {
    await admin
      .query(
        `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()`,
        [temporary.name],
      )
      .catch(() => undefined);
    await admin
      .query(`DROP DATABASE IF EXISTS "${temporary.name}"`)
      .catch(() => undefined);
    await admin.end();
  }
}

async function selectBackup() {
  if (process.env.PLATFORM_RESTORE_DRILL_BACKUP) {
    return resolve(process.env.PLATFORM_RESTORE_DRILL_BACKUP);
  }
  const entries = (await fs.readdir(backupRoot, { withFileTypes: true }))
    .filter(
      (entry) => entry.isDirectory() && /^\d{4}-\d{2}-\d{2}$/.test(entry.name),
    )
    .map((entry) => entry.name)
    .sort()
    .reverse();
  if (!entries.length) throw new Error('No dated platform backup was found.');
  return join(backupRoot, entries[0]);
}
