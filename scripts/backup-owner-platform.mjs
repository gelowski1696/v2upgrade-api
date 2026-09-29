import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import {
  backupRoot,
  copySnapshots,
  databaseUrl,
  datedBackupName,
  enforceRetention,
  metadataFingerprint,
  pool,
  postgresToolDatabaseUrl,
  readBackupMetadata,
  recordBackupOperation,
  runPostgresTool,
  safeRemove,
} from './platform-backup-lib.mjs';

const name = datedBackupName();
const staging = join(backupRoot, `.staging-${name}-${process.pid}`);
const destination = join(backupRoot, name);
let db;

await recordBackupOperation('platformBackup', 'RUNNING');
try {
  if (!databaseUrl) throw new Error('DATABASE_URL is required.');
  db = pool();
  await fs.mkdir(backupRoot, { recursive: true });
  await safeRemove(staging, backupRoot);
  await fs.mkdir(staging, { recursive: true });

  const before = await readBackupMetadata(db);
  const snapshots = await copySnapshots(before.snapshots, staging);
  const dumpPath = join(staging, 'metadata.dump');
  runPostgresTool('pg_dump', [
    `--dbname=${postgresToolDatabaseUrl(databaseUrl)}`,
    '--format=custom',
    '--no-owner',
    '--no-privileges',
    `--file=${dumpPath}`,
  ]);
  const after = await readBackupMetadata(db);
  if (metadataFingerprint(before) !== metadataFingerprint(after)) {
    throw new Error('Metadata changed during backup. Run the backup again.');
  }

  const manifest = {
    formatVersion: 1,
    createdAt: new Date().toISOString(),
    database: {
      engine: 'PostgreSQL',
      counts: before.counts,
      dump: 'metadata.dump',
    },
    snapshotRoot: 'snapshots',
    snapshots,
  };
  await fs.writeFile(
    join(staging, 'manifest.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );

  await safeRemove(destination, backupRoot);
  await fs.rename(staging, destination);
  await enforceRetention();
  await recordBackupOperation('platformBackup', 'PASS');
  console.log(
    JSON.stringify(
      {
        result: 'PASS',
        backup: destination,
        snapshots: snapshots.length,
        counts: before.counts,
      },
      null,
      2,
    ),
  );
} catch (error) {
  await safeRemove(staging, backupRoot).catch(() => undefined);
  await recordBackupOperation('platformBackup', 'FAIL', error).catch(() => undefined);
  throw error;
} finally {
  if (db) await db.end();
}
