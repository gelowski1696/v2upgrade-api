import 'dotenv/config';
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, existsSync } from 'node:fs';
import { promises as fs } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { spawnSync } from 'node:child_process';
import Database from 'better-sqlite3';
import pg from 'pg';

const { Pool } = pg;
export const databaseUrl = process.env.DATABASE_URL;
export const snapshotRoot = resolve(
  process.env.STORE_SNAPSHOT_ROOT ?? './data',
);
export const backupRoot = resolve(
  process.env.PLATFORM_BACKUP_ROOT ?? './backups',
);
export const backupHealthPath = join(backupRoot, 'health.json');

export async function recordBackupOperation(operation, status, error = '') {
  await fs.mkdir(backupRoot, { recursive: true });
  let health = {};
  try {
    health = JSON.parse(await fs.readFile(backupHealthPath, 'utf8'));
  } catch {
    health = {};
  }
  health[operation] = {
    status,
    checkedAt: new Date().toISOString(),
    error: String(error || '').slice(0, 2000),
  };
  await fs.writeFile(
    backupHealthPath,
    `${JSON.stringify(health, null, 2)}\n`,
    'utf8',
  );
  if (databaseUrl && status !== 'RUNNING') {
    const action =
      operation === 'restoreDrill'
        ? `backup.restore_drill_${status === 'PASS' ? 'passed' : 'failed'}`
        : `backup.platform_${status === 'PASS' ? 'passed' : 'failed'}`;
    const database = pool();
    try {
      await database.query(
        `INSERT INTO audit_logs
           (id, action, resource_type, metadata, created_at)
         VALUES ($1, $2, $3, $4::jsonb, NOW())`,
        [
          randomUUID(),
          action,
          'platform_backup',
          JSON.stringify({ operation, status }),
        ],
      );
    } catch {
      // Backup health remains available in health.json when audit persistence is unavailable.
    } finally {
      await database.end().catch(() => undefined);
    }
  }
}

export function datedBackupName(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

export function postgresTool(name) {
  const extension = process.platform === 'win32' ? '.exe' : '';
  const configured = process.env.POSTGRES_BIN;
  const candidates = [
    configured ? join(configured, `${name}${extension}`) : '',
    ...[18, 17, 16, 15, 14].map((version) =>
      join(
        'C:\\Program Files\\PostgreSQL',
        String(version),
        'bin',
        `${name}${extension}`,
      ),
    ),
    `${name}${extension}`,
  ].filter(Boolean);
  return candidates.find(
    (candidate) => candidate === `${name}${extension}` || existsSync(candidate),
  );
}

export function runPostgresTool(name, args) {
  const executable = postgresTool(name);
  const result = spawnSync(executable, args, {
    env: process.env,
    encoding: 'utf8',
    windowsHide: true,
  });
  if (result.status !== 0) {
    throw new Error(
      `${name} failed: ${(result.stderr || result.stdout || 'unknown error').trim()}`,
    );
  }
}

export function postgresToolDatabaseUrl(connectionString) {
  const url = new URL(connectionString);
  for (const parameter of [
    'schema',
    'connection_limit',
    'pool_timeout',
    'pgbouncer',
    'socket_timeout',
  ]) {
    url.searchParams.delete(parameter);
  }
  return url.toString();
}

export async function sha256(path) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}

export async function readBackupMetadata(pool) {
  const [snapshots, counts] = await Promise.all([
    pool.query(`
      SELECT ss.id, ss.store_id, ss.file_name, ss.file_size::text, ss.sha256,
             ss.status, ss.schema_version, ss.snapshot_created_at,
             (s.active_snapshot_id = ss.id) AS is_active
      FROM store_snapshots ss
      JOIN stores s ON s.id = ss.store_id
      WHERE ss.status IN ('ACTIVE', 'RETIRED')
      ORDER BY ss.store_id, ss.id
    `),
    pool.query(`
      SELECT
        (SELECT COUNT(*)::int FROM clients) AS clients,
        (SELECT COUNT(*)::int FROM stores) AS stores,
        (SELECT COUNT(*)::int FROM portal_users) AS portal_users,
        (SELECT COUNT(*)::int FROM devices) AS devices,
        (SELECT COUNT(*)::int FROM store_snapshots) AS snapshots,
        (SELECT COUNT(*)::int FROM web_analytics_events) AS analytics_events
    `),
  ]);
  return { snapshots: snapshots.rows, counts: counts.rows[0] };
}

export function metadataFingerprint(metadata) {
  return createHash('sha256').update(JSON.stringify(metadata)).digest('hex');
}

export function snapshotSourcePath(snapshot) {
  return join(
    snapshotRoot,
    'stores',
    snapshot.store_id,
    'snapshots',
    snapshot.file_name,
  );
}

export function snapshotBackupPath(root, snapshot) {
  return join(
    root,
    'snapshots',
    'stores',
    snapshot.store_id,
    'snapshots',
    snapshot.file_name,
  );
}

export async function copySnapshots(snapshots, destinationRoot) {
  const fingerprints = [];
  for (const snapshot of snapshots) {
    const source = snapshotSourcePath(snapshot);
    const destination = snapshotBackupPath(destinationRoot, snapshot);
    const stat = await fs.stat(source).catch(() => null);
    if (!stat?.isFile()) throw new Error(`Snapshot file is missing: ${source}`);
    if (stat.size !== Number(snapshot.file_size)) {
      throw new Error(`Snapshot size differs from metadata: ${source}`);
    }
    const sourceHash = await sha256(source);
    if (sourceHash !== snapshot.sha256) {
      throw new Error(`Snapshot checksum differs from metadata: ${source}`);
    }
    await fs.mkdir(dirname(destination), { recursive: true });
    await fs.copyFile(source, destination);
    const copiedHash = await sha256(destination);
    if (copiedHash !== sourceHash)
      throw new Error(`Snapshot copy verification failed: ${source}`);
    fingerprints.push({
      id: snapshot.id,
      storeId: snapshot.store_id,
      relativePath: relative(destinationRoot, destination).replaceAll(
        '\\',
        '/',
      ),
      fileSize: stat.size,
      sha256: copiedHash,
      status: snapshot.status,
      schemaVersion: snapshot.schema_version,
      snapshotCreatedAt: snapshot.snapshot_created_at,
      active: snapshot.is_active,
      dashboard: snapshot.is_active
        ? readDashboardFingerprint(destination)
        : null,
    });
  }
  return fingerprints;
}

export function readDashboardFingerprint(path) {
  const db = new Database(path, { readonly: true, fileMustExist: true });
  try {
    const saleColumns = columns(db, 'salestbl');
    const customerColumns = columns(db, 'custinfo');
    const inventoryColumns = columns(db, 'inventorytbl');
    const transferColumns = columns(db, 'pouttbl');
    const number = (value) => Number(value ?? 0);
    const sales = saleColumns.has('salesid')
      ? db
          .prepare(
            `
          SELECT COUNT(*) AS transactionCount,
                 COALESCE(SUM(CAST(COALESCE(salestotalamount, 0) AS REAL)), 0) AS grossSales,
                 COALESCE(SUM(CAST(COALESCE(salestotalcost, 0) AS REAL)), 0) AS costOfGoods,
                 COALESCE(SUM(CAST(COALESCE(salesdisc, 0) AS REAL) + CAST(COALESCE(specialdisc, 0) AS REAL)), 0) AS discounts
          FROM salestbl
          WHERE UPPER(TRIM(COALESCE(salestatus, ''))) <> 'CANCELLED'
        `,
          )
          .get()
      : {};
    const balances = customerColumns.has('custbalance')
      ? db
          .prepare(
            `SELECT COUNT(*) AS customersWithBalance, COALESCE(SUM(CAST(custbalance AS REAL)), 0) AS customerBalance FROM custinfo WHERE CAST(COALESCE(custbalance, 0) AS REAL) > 0 AND LOWER(TRIM(COALESCE(custstatus, 'active'))) <> 'inactive'`,
          )
          .get()
      : {};
    const inventory = inventoryColumns.has('invid')
      ? db.prepare('SELECT COUNT(*) AS inventoryItems FROM inventorytbl').get()
      : {};
    const transfers = transferColumns.has('poutid')
      ? db.prepare('SELECT COUNT(*) AS transfers FROM pouttbl').get()
      : {};
    return {
      transactionCount: number(sales.transactionCount),
      grossSales: number(sales.grossSales),
      discounts: number(sales.discounts),
      costOfGoods: number(sales.costOfGoods),
      grossProfit: number(sales.grossSales) - number(sales.costOfGoods),
      customerBalance: number(balances.customerBalance),
      customersWithBalance: number(balances.customersWithBalance),
      inventoryItems: number(inventory.inventoryItems),
      transfers: number(transfers.transfers),
    };
  } finally {
    db.close();
  }
}

function columns(db, table) {
  const exists = db
    .prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?`)
    .get(table);
  return exists
    ? new Set(
        db
          .prepare(`PRAGMA table_info(${table})`)
          .all()
          .map((row) => row.name),
      )
    : new Set();
}

export async function enforceRetention() {
  const retainDays = Number(process.env.PLATFORM_BACKUP_RETAIN_DAYS ?? 30);
  if (!Number.isInteger(retainDays) || retainDays < 1) {
    throw new Error('PLATFORM_BACKUP_RETAIN_DAYS must be a positive integer.');
  }
  await fs.mkdir(backupRoot, { recursive: true });
  const cutoff = Date.now() - retainDays * 86_400_000;
  const entries = await fs.readdir(backupRoot, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory() || !/^\d{4}-\d{2}-\d{2}$/.test(entry.name))
      continue;
    const timestamp = Date.parse(`${entry.name}T00:00:00.000Z`);
    if (Number.isFinite(timestamp) && timestamp < cutoff) {
      await safeRemove(join(backupRoot, entry.name), backupRoot);
    }
  }
}

export async function safeRemove(target, parent) {
  const resolvedTarget = resolve(target);
  const resolvedParent = resolve(parent);
  if (!isPathInside(resolvedTarget, resolvedParent)) {
    throw new Error(
      `Refusing to remove path outside backup root: ${resolvedTarget}`,
    );
  }
  await fs.rm(resolvedTarget, { recursive: true, force: true, maxRetries: 3 });
}

export function isPathInside(target, parent) {
  const relation = relative(resolve(parent), resolve(target));
  return (
    relation !== '' &&
    relation !== '..' &&
    !relation.startsWith(`..${sep}`) &&
    !isAbsolute(relation)
  );
}

export function temporaryDatabaseUrl() {
  const url = new URL(databaseUrl);
  const name = `posv2_restore_drill_${randomUUID().replaceAll('-', '')}`;
  url.pathname = `/${name}`;
  return { name, url: url.toString() };
}

export function pool(connectionString = databaseUrl) {
  return new Pool({ connectionString });
}
