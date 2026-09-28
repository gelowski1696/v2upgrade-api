import 'dotenv/config';
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import Database from 'better-sqlite3';
import pg from 'pg';

const { Pool } = pg;
const storeCount = 30;
const concurrency = Math.max(1, Number(process.env.SYNC_TEST_CONCURRENCY ?? 5));
const apiUrl = String(process.env.SYNC_TEST_API_URL ?? 'http://127.0.0.1:3100/api/v1').replace(/\/$/, '');
const runId = `sync30-${Date.now()}-${process.pid}`;
const workspace = join(tmpdir(), runId);
const snapshotRoot = resolve(process.env.STORE_SNAPSHOT_ROOT ?? './data');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const ids = {
  user: randomUUID(),
  client: randomUUID(),
  plan: randomUUID(),
  planVersion: randomUUID(),
  stores: [],
  subscriptions: [],
  devices: [],
};
const results = [];

try {
  await assertApiAvailable();
  await fs.mkdir(workspace, { recursive: true });
  await provisionStores();

  const stores = ids.stores.map((storeId, index) => ({
    index: index + 1,
    storeId,
    deviceId: ids.devices[index].installationId,
    databasePath: join(workspace, `store-${String(index + 1).padStart(2, '0')}.sqlite`),
  }));
  for (const store of stores) createStoreDatabase(store.databasePath, store.index, 1);

  const startedAt = performance.now();
  await mapConcurrent(stores, concurrency, async (store) => {
    const started = performance.now();
    const token = await deviceToken(store.deviceId);
    const snapshot = await synchronize(token, store.databasePath, `store-${store.index}-initial`);
    results.push({
      ...store,
      token,
      snapshotId: snapshot.snapshotId,
      durationMs: Math.round(performance.now() - started),
    });
  });
  const totalDurationMs = Math.round(performance.now() - startedAt);

  const activeRows = await pool.query(
    `SELECT id, active_snapshot_id FROM stores WHERE id = ANY($1::uuid[])`,
    [ids.stores],
  );
  if (activeRows.rowCount !== storeCount || activeRows.rows.some((row) => !row.active_snapshot_id)) {
    throw new Error(`Expected ${storeCount} active store snapshots after synchronization.`);
  }
  const uniqueHashes = await pool.query(
    `SELECT COUNT(DISTINCT sha256)::int AS count FROM store_snapshots WHERE store_id = ANY($1::uuid[])`,
    [ids.stores],
  );
  if (uniqueHashes.rows[0].count !== storeCount) {
    throw new Error('The synchronized databases were not unique across all stores.');
  }

  const retention = await verifyRetentionAndRollback(results[0]);
  const durations = results.map((result) => result.durationMs).sort((a, b) => a - b);
  console.log(JSON.stringify({
    result: 'PASS',
    runId,
    storesSynchronized: results.length,
    distinctDatabases: uniqueHashes.rows[0].count,
    concurrency,
    totalDurationMs,
    averageDurationMs: Math.round(durations.reduce((sum, value) => sum + value, 0) / durations.length),
    p95DurationMs: durations[Math.ceil(durations.length * 0.95) - 1],
    snapshotRetention: retention,
    cleanup: 'automatic',
  }, null, 2));
} finally {
  await cleanup().catch((error) => console.error(`Cleanup warning: ${error.message}`));
  await pool.end();
  await fs.rm(workspace, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
}

async function provisionStores() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const now = new Date();
    await client.query(
      `INSERT INTO users (id, username, display_name, password_hash, role, status, updated_at)
       VALUES ($1, $2, '30 Store Sync Test', 'not-used', 'SUPER_ADMIN', 'ACTIVE', $3)`,
      [ids.user, `${runId}-admin`, now],
    );
    await client.query(
      `INSERT INTO clients (id, code, business_name, status, updated_at)
       VALUES ($1, $2, '30 Store Sync Test', 'ACTIVE', $3)`,
      [ids.client, runId.slice(-32), now],
    );
    await client.query(
      `INSERT INTO plans (id, code, name, status, updated_at)
       VALUES ($1, $2, '30 Store Test Plan', 'ACTIVE', $3)`,
      [ids.plan, `P-${runId}`.slice(-40), now],
    );
    await client.query(
      `INSERT INTO plan_versions
       (id, plan_id, version, billing_interval, amount, currency, trial_days, grace_days, max_devices, features, published_at)
       VALUES ($1, $2, 1, 'MONTHLY', 0, 'PHP', 0, 7, 1, '{}'::jsonb, $3)`,
      [ids.planVersion, ids.plan, now],
    );
    for (let index = 1; index <= storeCount; index += 1) {
      const storeId = randomUUID();
      const subscriptionId = randomUUID();
      const deviceRecordId = randomUUID();
      const installationId = `${runId}-device-${index}`.toUpperCase();
      ids.stores.push(storeId);
      ids.subscriptions.push(subscriptionId);
      ids.devices.push({ id: deviceRecordId, installationId });
      await client.query(
        `INSERT INTO stores (id, client_id, code, name, status, timezone, updated_at)
         VALUES ($1, $2, $3, $4, 'ACTIVE', 'Asia/Manila', $5)`,
        [storeId, ids.client, `STORE-${index}`, `Load Test Store ${index}`, now],
      );
      await client.query(
        `INSERT INTO subscriptions
         (id, client_id, plan_version_id, status, starts_at, expires_at, amount, currency,
          billing_interval, max_devices, entitlements, notes, created_by_id, updated_at)
         VALUES ($1, $2, $3, 'ACTIVE', $4, $5, 0, 'PHP', 'MONTHLY', 1, '{}'::jsonb, $6, $7, $4)`,
        [subscriptionId, ids.client, ids.planVersion, new Date(now.getTime() - 86_400_000), new Date(now.getTime() + 86_400_000), runId, ids.user],
      );
      await client.query(
        `INSERT INTO devices
         (id, client_id, subscription_id, store_id, installation_id, label, platform, app_version, status, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, 'windows', 'sync-load-test', 'ACTIVE', $7)`,
        [deviceRecordId, ids.client, subscriptionId, storeId, installationId, `Load Device ${index}`, now],
      );
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

function createStoreDatabase(path, storeNumber, revision) {
  const database = new Database(path);
  database.exec(`
    CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT);
    CREATE TABLE salestbl (
      salesid INTEGER PRIMARY KEY, salesrefnum TEXT, salescust TEXT, salespaym TEXT,
      salescashier TEXT, salestotalitem INTEGER, salessub REAL, salestotalamount REAL,
      salescreditpaid REAL, salescreditbal TEXT, salestatus TEXT, salesdisc REAL,
      salescat TEXT, salescustid INTEGER, salespaytype TEXT, salestotalcost REAL,
      specialdisc REAL, salestender REAL, saleschange REAL, salesdate TEXT
    );
    CREATE TABLE salescart (scid INTEGER PRIMARY KEY);
    CREATE TABLE inventorytbl (itemid INTEGER PRIMARY KEY);
    CREATE TABLE custinfo (custid INTEGER PRIMARY KEY);
    CREATE TABLE pouttbl (poutid INTEGER PRIMARY KEY);
    INSERT INTO schema_migrations VALUES (27, datetime('now'));
  `);
  database.prepare(`
    INSERT INTO salestbl
    (salesid, salesrefnum, salestotalitem, salestotalamount, salestatus, salesdisc,
     salestotalcost, specialdisc, salesdate)
    VALUES (?, ?, 1, ?, 'COMPLETED', 0, ?, 0, datetime('now'))
  `).run(revision, `STORE-${storeNumber}-R${revision}`, storeNumber * 100 + revision, storeNumber * 50 + revision);
  database.close();
}

async function verifyRetentionAndRollback(store) {
  const initialSnapshotId = store.snapshotId;
  for (let revision = 2; revision <= 4; revision += 1) {
    await fs.rm(store.databasePath, { force: true });
    createStoreDatabase(store.databasePath, store.index, revision);
    await synchronize(store.token, store.databasePath, `store-${store.index}-revision-${revision}`);
  }
  const snapshots = await request('/device-sync/snapshots', { token: store.token });
  if (snapshots.length !== 3) {
    throw new Error(`Retention expected 3 snapshots but found ${snapshots.length}.`);
  }
  if (snapshots.some((snapshot) => snapshot.id === initialSnapshotId)) {
    throw new Error('Retention did not remove the oldest retired snapshot.');
  }
  const previous = snapshots.find((snapshot) => snapshot.status === 'RETIRED');
  if (!previous) throw new Error('No retained snapshot was available for rollback.');
  await request(`/device-sync/snapshots/${previous.id}/reactivate`, {
    method: 'POST',
    token: store.token,
  });
  const status = await request('/device-sync/status', { token: store.token });
  if (status.activeSnapshot?.id !== previous.id) {
    throw new Error('Snapshot rollback did not activate the selected database.');
  }
  return { retained: snapshots.length, oldestRemoved: true, rollbackVerified: true };
}

async function synchronize(token, path, applicationVersion) {
  const buffer = await fs.readFile(path);
  const sha256 = createHash('sha256').update(buffer).digest('hex');
  const session = await request('/device-sync/sessions', {
    method: 'POST',
    token,
    body: {
      schemaVersion: 27,
      applicationVersion,
      snapshotCreatedAt: new Date().toISOString(),
      fileSize: buffer.length,
      sha256,
    },
  });
  if (session.duplicate) return session;
  const upload = await fetch(`${apiUrl}/device-sync/sessions/${session.id}/file`, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/octet-stream',
      'Content-Length': String(buffer.length),
    },
    body: createReadStream(path),
    duplex: 'half',
  });
  if (!upload.ok) throw new Error(await responseMessage(upload, 'Snapshot upload failed.'));
  return request(`/device-sync/sessions/${session.id}/complete`, { method: 'POST', token });
}

async function deviceToken(deviceId) {
  const license = await request('/licenses/validate', { method: 'POST', body: { deviceId } });
  if (!license.valid || !license.deviceAccessToken) {
    throw new Error(`License validation failed for ${deviceId}: ${license.message ?? 'unknown error'}`);
  }
  return license.deviceAccessToken;
}

async function assertApiAvailable() {
  try {
    const response = await fetch(`${apiUrl}/health`);
    if (!response.ok) throw new Error(String(response.status));
  } catch {
    throw new Error(`Subscription API is not running at ${apiUrl}.`);
  }
}

async function cleanup() {
  if (!ids.stores.length) return;
  const snapshotRows = await pool.query(
    `SELECT id FROM store_snapshots WHERE store_id = ANY($1::uuid[])`,
    [ids.stores],
  ).catch(() => ({ rows: [] }));
  const snapshotIds = snapshotRows.rows.map((row) => row.id);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    if (snapshotIds.length) {
      await client.query(`DELETE FROM audit_logs WHERE resource_id = ANY($1::text[])`, [snapshotIds]);
    }
    await client.query(
      `DELETE FROM audit_logs
       WHERE action LIKE 'sync.%' AND metadata->>'storeId' = ANY($1::text[])`,
      [ids.stores],
    );
    await client.query(`DELETE FROM sync_upload_sessions WHERE store_id = ANY($1::uuid[])`, [ids.stores]);
    await client.query(`UPDATE stores SET active_snapshot_id = NULL WHERE id = ANY($1::uuid[])`, [ids.stores]);
    await client.query(`DELETE FROM store_snapshots WHERE store_id = ANY($1::uuid[])`, [ids.stores]);
    await client.query(`DELETE FROM license_leases WHERE device_id = ANY($1::uuid[])`, [ids.devices.map((device) => device.id)]);
    await client.query(`DELETE FROM devices WHERE id = ANY($1::uuid[])`, [ids.devices.map((device) => device.id)]);
    await client.query(`DELETE FROM subscriptions WHERE id = ANY($1::uuid[])`, [ids.subscriptions]);
    await client.query(`DELETE FROM stores WHERE id = ANY($1::uuid[])`, [ids.stores]);
    await client.query(`DELETE FROM clients WHERE id = $1`, [ids.client]);
    await client.query(`DELETE FROM plan_versions WHERE id = $1`, [ids.planVersion]);
    await client.query(`DELETE FROM plans WHERE id = $1`, [ids.plan]);
    await client.query(`DELETE FROM users WHERE id = $1`, [ids.user]);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
  await Promise.all(ids.stores.map((storeId) => fs.rm(join(snapshotRoot, 'stores', storeId), { recursive: true, force: true })));
}

async function mapConcurrent(values, limit, operation) {
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, values.length) }, async () => {
    while (cursor < values.length) {
      const index = cursor;
      cursor += 1;
      await operation(values[index]);
    }
  });
  await Promise.all(workers);
}

async function request(path, options = {}) {
  const headers = { Accept: 'application/json' };
  if (options.token) headers.Authorization = `Bearer ${options.token}`;
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  const response = await fetch(`${apiUrl}${path}`, {
    method: options.method ?? 'GET',
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  if (!response.ok) throw new Error(await responseMessage(response, `${options.method ?? 'GET'} ${path} failed.`));
  return response.status === 204 ? null : response.json();
}

async function responseMessage(response, fallback) {
  try {
    const value = await response.json();
    return Array.isArray(value.message) ? value.message.join(' ') : value.message ?? fallback;
  } catch {
    return fallback;
  }
}
