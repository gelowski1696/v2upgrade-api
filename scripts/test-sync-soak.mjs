import 'dotenv/config';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import Database from 'better-sqlite3';
import pg from 'pg';

const { Pool } = pg;
const storeCount = positiveInteger('SYNC_SOAK_STORES', 12, 2);
const cycleCount = positiveInteger('SYNC_SOAK_CYCLES', 8, 3);
const concurrency = positiveInteger('SYNC_SOAK_CONCURRENCY', 6, 1);
const interruptionEvery = positiveInteger('SYNC_SOAK_INTERRUPT_EVERY', 4, 2);
const payloadKilobytes = positiveInteger('SYNC_SOAK_PAYLOAD_KB', 64, 8);
const apiUrl = String(
  process.env.SYNC_TEST_API_URL ?? 'http://127.0.0.1:3100/api/v1',
).replace(/\/$/, '');
const snapshotRoot = resolve(process.env.STORE_SNAPSHOT_ROOT ?? './data');
const runId = `sync-soak-${Date.now()}-${process.pid}`;
const workspace = join(tmpdir(), runId);
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const ids = {
  user: randomUUID(),
  plan: randomUUID(),
  planVersion: randomUUID(),
  clients: [],
  stores: [],
  subscriptions: [],
  devices: [],
};
const metrics = {
  successfulUploads: 0,
  interruptedUploads: 0,
  successfulRetries: 0,
  uploadDurationsMs: [],
  cycles: [],
};

try {
  await assertApiAvailable();
  await fs.mkdir(workspace, { recursive: true });
  await provisionTenants();

  const stores = await mapConcurrent(
    ids.stores.map((storeId, index) => ({
      index: index + 1,
      storeId,
      deviceId: ids.devices[index].installationId,
      databasePath: join(
        workspace,
        `store-${String(index + 1).padStart(2, '0')}.sqlite`,
      ),
      activeSnapshotId: null,
      expectedSha256: null,
    })),
    concurrency,
    async (store) => ({
      ...store,
      token: await deviceToken(store.deviceId),
    }),
  );

  const startedAt = performance.now();
  for (let cycle = 1; cycle <= cycleCount; cycle += 1) {
    const cycleStartedAt = performance.now();
    let cycleInterruptions = 0;

    await mapConcurrent(stores, concurrency, async (store) => {
      await fs.rm(store.databasePath, { force: true });
      createStoreDatabase(store.databasePath, store.index, cycle);
      const buffer = await fs.readFile(store.databasePath);
      const sha256 = createHash('sha256').update(buffer).digest('hex');
      const shouldInterrupt = (store.index + cycle) % interruptionEvery === 0;

      if (shouldInterrupt) {
        const interrupted = await createSession(
          store.token,
          buffer,
          sha256,
          `soak-${cycle}-interrupted`,
        );
        await interruptUpload(store.token, interrupted.id, buffer);
        const rejected = await waitForSessionStatus(
          store.token,
          interrupted.id,
          'REJECTED',
        );
        if (rejected.rejectionCode !== 'UPLOAD_INTERRUPTED') {
          throw new Error(
            `Store ${store.index} interruption was rejected as ${rejected.rejectionCode ?? 'unknown'} instead of UPLOAD_INTERRUPTED.`,
          );
        }
        await assertActiveSnapshot(store, store.activeSnapshotId);
        metrics.interruptedUploads += 1;
        cycleInterruptions += 1;
      }

      const uploadStartedAt = performance.now();
      const completed = await synchronize(
        store.token,
        buffer,
        sha256,
        `soak-${cycle}-store-${store.index}`,
      );
      metrics.uploadDurationsMs.push(
        Math.round(performance.now() - uploadStartedAt),
      );
      metrics.successfulUploads += 1;
      if (shouldInterrupt) metrics.successfulRetries += 1;
      store.activeSnapshotId = completed.snapshotId;
      store.expectedSha256 = sha256;
    });

    await verifyCycleState(stores, cycle);
    const cycleDurationMs = Math.round(performance.now() - cycleStartedAt);
    metrics.cycles.push({
      cycle,
      durationMs: cycleDurationMs,
      interruptions: cycleInterruptions,
    });
    console.log(
      `Cycle ${cycle}/${cycleCount}: ${storeCount} stores synchronized, ${cycleInterruptions} interrupted uploads recovered in ${cycleDurationMs} ms.`,
    );
  }

  const storage = await verifyFinalStorage(stores);
  const durationMs = Math.round(performance.now() - startedAt);
  const durations = [...metrics.uploadDurationsMs].sort((a, b) => a - b);
  console.log(
    JSON.stringify(
      {
        result: 'PASS',
        runId,
        stores: storeCount,
        isolatedTenants: ids.clients.length,
        cycles: cycleCount,
        concurrency,
        successfulUploads: metrics.successfulUploads,
        interruptedUploads: metrics.interruptedUploads,
        successfulRetries: metrics.successfulRetries,
        totalDurationMs: durationMs,
        averageUploadMs: Math.round(
          durations.reduce((sum, value) => sum + value, 0) / durations.length,
        ),
        p95UploadMs: durations[Math.ceil(durations.length * 0.95) - 1],
        retainedSnapshots: storage.retainedSnapshots,
        danglingSessions: storage.danglingSessions,
        stagingFiles: storage.stagingFiles,
        cycleResults: metrics.cycles,
        cleanup: 'automatic',
      },
      null,
      2,
    ),
  );
} finally {
  await cleanup().catch((error) =>
    console.error(`Cleanup warning: ${error.message}`),
  );
  await pool.end();
  await fs.rm(workspace, {
    recursive: true,
    force: true,
    maxRetries: 3,
    retryDelay: 100,
  });
}

async function provisionTenants() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const now = new Date();
    await client.query(
      `INSERT INTO users
       (id, username, display_name, password_hash, role, status, updated_at)
       VALUES ($1, $2, 'Synchronization Soak Test', 'not-used', 'SUPER_ADMIN', 'ACTIVE', $3)`,
      [ids.user, `${runId}-admin`, now],
    );
    await client.query(
      `INSERT INTO plans (id, code, name, status, updated_at)
       VALUES ($1, $2, 'Synchronization Soak Plan', 'ACTIVE', $3)`,
      [ids.plan, `P-${runId}`.slice(-40), now],
    );
    await client.query(
      `INSERT INTO plan_versions
       (id, plan_id, version, billing_interval, amount, currency, trial_days,
        grace_days, max_devices, features, published_at)
       VALUES ($1, $2, 1, 'MONTHLY', 0, 'PHP', 0, 7, 1, '{}'::jsonb, $3)`,
      [ids.planVersion, ids.plan, now],
    );

    for (let index = 1; index <= storeCount; index += 1) {
      const clientId = randomUUID();
      const storeId = randomUUID();
      const subscriptionId = randomUUID();
      const deviceId = randomUUID();
      const installationId = `${runId}-device-${index}`.toUpperCase();
      ids.clients.push(clientId);
      ids.stores.push(storeId);
      ids.subscriptions.push(subscriptionId);
      ids.devices.push({ id: deviceId, installationId });

      await client.query(
        `INSERT INTO clients (id, code, business_name, status, updated_at)
         VALUES ($1, $2, $3, 'ACTIVE', $4)`,
        [
          clientId,
          `${runId.slice(-23)}-${index}`.slice(-40),
          `Synchronization Soak Tenant ${index}`,
          now,
        ],
      );
      await client.query(
        `INSERT INTO stores
         (id, client_id, code, name, status, timezone, updated_at)
         VALUES ($1, $2, 'MAIN', $3, 'ACTIVE', 'Asia/Manila', $4)`,
        [storeId, clientId, `Soak Store ${index}`, now],
      );
      await client.query(
        `INSERT INTO subscriptions
         (id, client_id, plan_version_id, status, starts_at, expires_at, amount,
          currency, billing_interval, max_devices, entitlements, notes,
          created_by_id, updated_at)
         VALUES ($1, $2, $3, 'ACTIVE', $4, $5, 0, 'PHP', 'MONTHLY', 1,
          '{}'::jsonb, $6, $7, $4)`,
        [
          subscriptionId,
          clientId,
          ids.planVersion,
          new Date(now.getTime() - 86_400_000),
          new Date(now.getTime() + 86_400_000),
          runId,
          ids.user,
        ],
      );
      await client.query(
        `INSERT INTO devices
         (id, client_id, subscription_id, store_id, installation_id, label,
          platform, app_version, status, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, 'windows', 'sync-soak-test', 'ACTIVE', $7)`,
        [
          deviceId,
          clientId,
          subscriptionId,
          storeId,
          installationId,
          `Soak Device ${index}`,
          now,
        ],
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
    CREATE TABLE inventorytbl (itemid INTEGER PRIMARY KEY, fillqty INTEGER, alertnum INTEGER);
    CREATE TABLE custinfo (custid INTEGER PRIMARY KEY, custbalance REAL, custstatus TEXT);
    CREATE TABLE pouttbl (poutid INTEGER PRIMARY KEY, pulldate TEXT);
    CREATE TABLE soak_payload (id INTEGER PRIMARY KEY, payload BLOB);
    INSERT INTO schema_migrations VALUES (27, datetime('now'));
    INSERT INTO inventorytbl VALUES (1, 100, 10);
    INSERT INTO custinfo VALUES (1, 0, 'active');
    INSERT INTO pouttbl VALUES (1, datetime('now'));
  `);
  database
    .prepare(
      `INSERT INTO salestbl
       (salesid, salesrefnum, salestotalitem, salestotalamount, salestatus,
        salesdisc, salestotalcost, specialdisc, salesdate)
       VALUES (?, ?, 1, ?, 'COMPLETED', 0, ?, 0, datetime('now'))`,
    )
    .run(
      revision,
      `SOAK-${storeNumber}-R${revision}`,
      storeNumber * 100 + revision,
      storeNumber * 50 + revision,
    );
  database
    .prepare('INSERT INTO soak_payload (id, payload) VALUES (1, ?)')
    .run(randomBytes(payloadKilobytes * 1024));
  database.close();
}

async function synchronize(token, buffer, sha256, applicationVersion) {
  const session = await createSession(
    token,
    buffer,
    sha256,
    applicationVersion,
  );
  if (session.duplicate) {
    throw new Error(
      'A soak-test revision unexpectedly matched an existing snapshot.',
    );
  }
  const upload = await fetch(
    `${apiUrl}/device-sync/sessions/${session.id}/file`,
    {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/octet-stream',
        'Content-Length': String(buffer.length),
      },
      body: buffer,
    },
  );
  if (!upload.ok) {
    throw new Error(await responseMessage(upload, 'Snapshot upload failed.'));
  }
  return request(`/device-sync/sessions/${session.id}/complete`, {
    method: 'POST',
    token,
  });
}

function createSession(token, buffer, sha256, applicationVersion) {
  return request('/device-sync/sessions', {
    method: 'POST',
    expectedStatus: 201,
    token,
    body: {
      schemaVersion: 27,
      applicationVersion,
      snapshotCreatedAt: new Date().toISOString(),
      fileSize: buffer.length,
      sha256,
    },
  });
}

async function interruptUpload(token, sessionId, buffer) {
  const target = new URL(`${apiUrl}/device-sync/sessions/${sessionId}/file`);
  const transport = target.protocol === 'https:' ? https : http;
  const partialLength = Math.max(
    1,
    Math.min(buffer.length - 1, Math.floor(buffer.length / 4)),
  );

  await new Promise((resolvePromise, rejectPromise) => {
    let settled = false;
    const settle = (error) => {
      if (settled) return;
      settled = true;
      if (error) rejectPromise(error);
      else resolvePromise();
    };
    const request = transport.request(
      target,
      {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/octet-stream',
          'Content-Length': String(buffer.length),
        },
      },
      (response) => {
        response.resume();
        response.once('end', () =>
          settle(
            response.statusCode && response.statusCode >= 400
              ? new Error(
                  `Interrupted upload unexpectedly returned HTTP ${response.statusCode}.`,
                )
              : undefined,
          ),
        );
      },
    );
    request.once('error', (error) => {
      if (error.message === 'SYNC_SOAK_INTENTIONAL_DISCONNECT') settle();
      else settle(error);
    });
    request.write(buffer.subarray(0, partialLength));
    setTimeout(
      () => request.destroy(new Error('SYNC_SOAK_INTENTIONAL_DISCONNECT')),
      20,
    );
  });
}

async function waitForSessionStatus(token, sessionId, expectedStatus) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const session = await request(`/device-sync/sessions/${sessionId}`, {
      token,
    });
    if (session.status === expectedStatus) return session;
    await delay(50);
  }
  throw new Error(
    `Upload session ${sessionId} did not reach ${expectedStatus} within 10 seconds.`,
  );
}

async function assertActiveSnapshot(store, expectedSnapshotId) {
  const status = await request('/device-sync/status', { token: store.token });
  const actualSnapshotId = status.activeSnapshot?.id ?? null;
  if (actualSnapshotId !== expectedSnapshotId) {
    throw new Error(
      `Interrupted upload changed Store ${store.index} active snapshot from ${expectedSnapshotId ?? 'none'} to ${actualSnapshotId ?? 'none'}.`,
    );
  }
}

async function verifyCycleState(stores, cycle) {
  const result = await pool.query(
    `SELECT s.id AS store_id, s.active_snapshot_id, snapshot.sha256,
            COUNT(all_snapshots.id)::int AS snapshot_count
     FROM stores s
     LEFT JOIN store_snapshots snapshot ON snapshot.id = s.active_snapshot_id
     LEFT JOIN store_snapshots all_snapshots ON all_snapshots.store_id = s.id
     WHERE s.id = ANY($1::uuid[])
     GROUP BY s.id, s.active_snapshot_id, snapshot.sha256`,
    [ids.stores],
  );
  if (result.rowCount !== stores.length) {
    throw new Error(`Cycle ${cycle} did not return every isolated test store.`);
  }
  const expectedCount = Math.min(cycle, 3);
  for (const store of stores) {
    const row = result.rows.find(
      (candidate) => candidate.store_id === store.storeId,
    );
    if (
      !row ||
      row.active_snapshot_id !== store.activeSnapshotId ||
      row.sha256 !== store.expectedSha256
    ) {
      throw new Error(
        `Cycle ${cycle} active snapshot mismatch for Store ${store.index}.`,
      );
    }
    if (row.snapshot_count !== expectedCount) {
      throw new Error(
        `Cycle ${cycle} expected ${expectedCount} retained snapshots for Store ${store.index}, found ${row.snapshot_count}.`,
      );
    }
  }
}

async function verifyFinalStorage(stores) {
  const expectedRetained = stores.length * Math.min(cycleCount, 3);
  const snapshotRows = await pool.query(
    `SELECT id, store_id FROM store_snapshots
     WHERE store_id = ANY($1::uuid[])`,
    [ids.stores],
  );
  if (snapshotRows.rowCount !== expectedRetained) {
    throw new Error(
      `Expected ${expectedRetained} retained snapshots, found ${snapshotRows.rowCount}.`,
    );
  }
  await Promise.all(
    snapshotRows.rows.map((row) =>
      fs.access(
        join(
          snapshotRoot,
          'stores',
          row.store_id,
          'snapshots',
          `${row.id}.sqlite`,
        ),
      ),
    ),
  );

  const dangling = await pool.query(
    `SELECT COUNT(1)::int AS count FROM sync_upload_sessions
     WHERE store_id = ANY($1::uuid[])
       AND status IN ('CREATED', 'UPLOADING', 'UPLOADED', 'VALIDATING')`,
    [ids.stores],
  );
  const stagingFiles = (
    await Promise.all(
      stores.map(async (store) => {
        const staging = join(snapshotRoot, 'stores', store.storeId, 'staging');
        return fs.readdir(staging).catch(() => []);
      }),
    )
  ).flat();
  if (dangling.rows[0].count !== 0 || stagingFiles.length !== 0) {
    throw new Error(
      `Soak test left ${dangling.rows[0].count} writable sessions and ${stagingFiles.length} staging files.`,
    );
  }
  return {
    retainedSnapshots: snapshotRows.rowCount,
    danglingSessions: dangling.rows[0].count,
    stagingFiles: stagingFiles.length,
  };
}

async function deviceToken(deviceId) {
  const license = await request('/licenses/validate', {
    method: 'POST',
    expectedStatus: 201,
    body: { deviceId },
  });
  if (!license.valid || !license.deviceAccessToken) {
    throw new Error(`License validation failed for ${deviceId}.`);
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
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `DELETE FROM audit_logs
       WHERE metadata->>'storeId' = ANY($1::text[])
          OR metadata->>'clientId' = ANY($2::text[])`,
      [ids.stores, ids.clients],
    );
    await client.query(
      `DELETE FROM sync_upload_sessions WHERE store_id = ANY($1::uuid[])`,
      [ids.stores],
    );
    await client.query(
      `UPDATE stores SET active_snapshot_id = NULL WHERE id = ANY($1::uuid[])`,
      [ids.stores],
    );
    await client.query(
      `DELETE FROM store_snapshots WHERE store_id = ANY($1::uuid[])`,
      [ids.stores],
    );
    await client.query(
      `DELETE FROM license_leases WHERE device_id = ANY($1::uuid[])`,
      [ids.devices.map((device) => device.id)],
    );
    await client.query(`DELETE FROM devices WHERE id = ANY($1::uuid[])`, [
      ids.devices.map((device) => device.id),
    ]);
    await client.query(`DELETE FROM subscriptions WHERE id = ANY($1::uuid[])`, [
      ids.subscriptions,
    ]);
    await client.query(`DELETE FROM stores WHERE id = ANY($1::uuid[])`, [
      ids.stores,
    ]);
    await client.query(`DELETE FROM clients WHERE id = ANY($1::uuid[])`, [
      ids.clients,
    ]);
    await client.query(`DELETE FROM plan_versions WHERE id = $1`, [
      ids.planVersion,
    ]);
    await client.query(`DELETE FROM plans WHERE id = $1`, [ids.plan]);
    await client.query(`DELETE FROM users WHERE id = $1`, [ids.user]);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
  await Promise.all(
    ids.stores.map((storeId) =>
      fs.rm(join(snapshotRoot, 'stores', storeId), {
        recursive: true,
        force: true,
      }),
    ),
  );
}

async function mapConcurrent(values, limit, operation) {
  const results = new Array(values.length);
  let cursor = 0;
  const workers = Array.from(
    { length: Math.min(limit, values.length) },
    async () => {
      while (cursor < values.length) {
        const index = cursor;
        cursor += 1;
        results[index] = await operation(values[index], index);
      }
    },
  );
  await Promise.all(workers);
  return results;
}

async function request(path, options = {}) {
  const response = await send(path, options);
  const expectedStatus = options.expectedStatus ?? 200;
  if (response.status !== expectedStatus) {
    throw new Error(
      await responseMessage(
        response,
        `${options.method ?? 'GET'} ${path} returned HTTP ${response.status}.`,
      ),
    );
  }
  return response.status === 204 ? null : response.json();
}

function send(path, options) {
  const headers = { Accept: 'application/json' };
  if (options.token) headers.Authorization = `Bearer ${options.token}`;
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  return fetch(`${apiUrl}${path}`, {
    method: options.method ?? 'GET',
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
}

async function responseMessage(response, fallback) {
  try {
    const value = await response.json();
    const message = Array.isArray(value.message)
      ? value.message.join(' ')
      : value.message;
    return `${message ?? fallback}${value.code ? ` (${value.code})` : ''}`;
  } catch {
    return fallback;
  }
}

function positiveInteger(name, fallback, minimum) {
  const parsed = Number(process.env[name] ?? fallback);
  if (!Number.isSafeInteger(parsed) || parsed < minimum) {
    throw new Error(
      `${name} must be an integer greater than or equal to ${minimum}.`,
    );
  }
  return parsed;
}

function delay(milliseconds) {
  return new Promise((resolvePromise) =>
    setTimeout(resolvePromise, milliseconds),
  );
}
