import 'dotenv/config';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import Database from 'better-sqlite3';
import pg from 'pg';

const { Pool } = pg;
const apiUrl = String(
  process.env.SYNC_TEST_API_URL ?? 'http://127.0.0.1:3100/api/v1',
).replace(/\/$/, '');
const snapshotRoot = resolve(process.env.STORE_SNAPSHOT_ROOT ?? './data');
const maximumSnapshotBytes = Number(
  process.env.STORE_SNAPSHOT_MAX_BYTES ?? 512 * 1024 * 1024,
);
const runId = `sync-security-${Date.now()}-${process.pid}`;
const workspace = join(tmpdir(), runId);
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const ids = {
  user: randomUUID(),
  plan: randomUUID(),
  planVersion: randomUUID(),
  clients: [randomUUID(), randomUUID()],
  stores: [randomUUID(), randomUUID()],
  subscriptions: [randomUUID(), randomUUID()],
  devices: [
    { id: randomUUID(), installationId: `${runId}-DEVICE-A`.toUpperCase() },
    { id: randomUUID(), installationId: `${runId}-DEVICE-B`.toUpperCase() },
  ],
};
const temporaryFiles = [];
const checks = [];

try {
  await assertApiAvailable();
  await fs.mkdir(workspace, { recursive: true });
  await provisionTenants();

  const stores = await Promise.all(
    ids.stores.map(async (storeId, index) => {
      const databasePath = join(workspace, `tenant-${index + 1}.sqlite`);
      createStoreDatabase(databasePath, index + 1);
      const token = await deviceToken(ids.devices[index].installationId);
      const sync = await synchronize(
        token,
        databasePath,
        `security-tenant-${index + 1}`,
      );
      return {
        storeId,
        databasePath,
        token,
        sessionId: sync.id,
        snapshotId: sync.snapshotId,
      };
    }),
  );

  await verifyTokenTampering(stores);
  await verifyDeviceIsolation(stores);
  const portal = await createPortalAccount(stores[0]);
  await verifyPortalIsolation(portal.accessToken, stores);
  await verifyRejectedUploadsPreserveActive(stores[0]);
  await verifyMissingSnapshotResponse(portal.accessToken, stores[0]);
  await verifyPortalAccountSecurity(stores[0], portal);

  console.log(
    JSON.stringify(
      {
        result: 'PASS',
        runId,
        checksPassed: checks.length,
        checks,
        activeSnapshotsPreserved: true,
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

async function verifyTokenTampering(stores) {
  await expectStatus('/device-sync/status', 401, {
    token: `${stores[0].token}tampered`,
  });
  pass('Tampered device credential is rejected');

  await expectStatus('/device-sync/sessions/not-a-uuid', 400, {
    token: stores[0].token,
  });
  pass(
    'Malformed synchronization identifiers are rejected at the HTTP boundary',
  );

  await expectStatus('/portal/stores', 401, {
    token: 'not-a-valid-portal-token',
  });
  pass('Invalid portal credential is rejected');
}

async function verifyDeviceIsolation([storeA, storeB]) {
  await expectStatus(`/device-sync/sessions/${storeB.sessionId}`, 404, {
    token: storeA.token,
  });
  pass('Device A cannot read Store B upload session');

  await uploadBytes(
    storeA.token,
    storeB.sessionId,
    Buffer.from('cross-store-upload-attempt'),
    404,
  );
  pass('Device A cannot upload bytes to Store B session');

  await expectStatus(
    `/device-sync/sessions/${storeB.sessionId}/complete`,
    404,
    { method: 'POST', token: storeA.token },
  );
  pass('Device A cannot finalize Store B upload session');

  await expectStatus(
    `/device-sync/snapshots/${storeB.snapshotId}/reactivate`,
    404,
    { method: 'POST', token: storeA.token },
  );
  pass('Device A cannot reactivate Store B snapshot');

  await assertActiveSnapshot(storeA.token, storeA.snapshotId);
  await assertActiveSnapshot(storeB.token, storeB.snapshotId);
  pass('Cross-store device attempts preserve both active snapshots');
}

async function createPortalAccount(store) {
  const username = `${runId}@local.test`;
  const password = `Secure-${randomBytes(16).toString('hex')}`;
  const invitation = await request('/device-portal/invitations', {
    method: 'POST',
    expectedStatus: 201,
    token: store.token,
    body: {
      username,
      displayName: 'Isolation Test Owner',
      role: 'OWNER',
    },
  });
  const session = await request('/portal/auth/activate', {
    method: 'POST',
    body: { token: invitation.activationToken, password },
  });
  return {
    ...session,
    username,
    password,
    activationToken: invitation.activationToken,
  };
}

async function verifyPortalAccountSecurity(store, portal) {
  await expectStatus('/portal/auth/activate', 401, {
    method: 'POST',
    body: { token: portal.activationToken, password: portal.password },
  });
  pass('Portal invitation tokens are single-use');

  const expiredInvitation = await request('/device-portal/invitations', {
    method: 'POST',
    expectedStatus: 201,
    token: store.token,
    body: {
      username: `${runId}-expired@local.test`,
      displayName: 'Expired Invitation Test',
      role: 'VIEWER',
    },
  });
  const expired = await pool.query(
    `UPDATE portal_invitations
     SET expires_at = NOW() - INTERVAL '1 day'
     WHERE id = $1
     RETURNING id, expires_at`,
    [expiredInvitation.id],
  );
  if (expired.rowCount !== 1 || expired.rows[0].expires_at >= new Date()) {
    throw new Error('Expired invitation fixture could not be prepared.');
  }
  await expectStatus('/portal/auth/activate', 401, {
    method: 'POST',
    body: {
      token: expiredInvitation.activationToken,
      password: portal.password,
    },
  });
  pass('Expired portal invitations cannot be activated');

  const secondary = await request('/portal/auth/login', {
    method: 'POST',
    body: { username: portal.username, password: portal.password },
    headers: { 'User-Agent': 'POSV2 Security Test Secondary Browser' },
  });
  const sessions = await request('/portal/auth/sessions', {
    token: portal.accessToken,
  });
  const secondarySession = sessions.find(
    (session) => session.id === secondary.user.sessionId,
  );
  if (!secondarySession || secondarySession.current) {
    throw new Error('Secondary portal session was not listed correctly.');
  }
  await expectStatus(`/portal/auth/sessions/${secondarySession.id}`, 204, {
    method: 'DELETE',
    token: portal.accessToken,
  });
  await expectStatus('/portal/auth/me', 401, { token: secondary.accessToken });
  pass('Owners can list and force logout an individual browser session');

  const other = await request('/portal/auth/login', {
    method: 'POST',
    body: { username: portal.username, password: portal.password },
    headers: { 'User-Agent': 'POSV2 Security Test Other Browser' },
  });
  await expectStatus('/portal/auth/sessions/revoke-others', 204, {
    method: 'POST',
    token: portal.accessToken,
  });
  await expectStatus('/portal/auth/me', 401, { token: other.accessToken });
  await expectStatus('/portal/auth/me', 200, { token: portal.accessToken });
  pass(
    'Owners can force logout every other session while retaining the current one',
  );

  await expectStatus(`/device-portal/users/${portal.user.id}/disable`, 204, {
    method: 'POST',
    token: store.token,
  });
  await expectStatus('/portal/auth/login', 401, {
    method: 'POST',
    body: { username: portal.username, password: portal.password },
  });
  await expectStatus('/portal/auth/refresh', 401, {
    method: 'POST',
    body: { refreshToken: portal.refreshToken },
  });
  await expectStatus('/portal/auth/me', 401, { token: portal.accessToken });
  pass(
    'Disabled users cannot login, refresh, or continue an existing access session',
  );

  await expectStatus(`/device-portal/users/${portal.user.id}/enable`, 204, {
    method: 'POST',
    token: store.token,
  });
  const reset = await request(
    `/device-portal/users/${portal.user.id}/password-reset`,
    { method: 'POST', token: store.token, expectedStatus: 201 },
  );
  const resetPassword = `Reset-${randomBytes(16).toString('hex')}`;
  await expectStatus('/portal/auth/reset-password', 204, {
    method: 'POST',
    body: { token: reset.resetToken, newPassword: resetPassword },
  });
  await expectStatus('/portal/auth/reset-password', 401, {
    method: 'POST',
    body: { token: reset.resetToken, newPassword: resetPassword },
  });
  await expectStatus('/portal/auth/login', 401, {
    method: 'POST',
    body: { username: portal.username, password: portal.password },
  });
  const resetSession = await request('/portal/auth/login', {
    method: 'POST',
    body: { username: portal.username, password: resetPassword },
  });
  pass('Administrator-issued password reset tokens expire after one use');

  await expectStatus('/portal/auth/change-password', 401, {
    method: 'POST',
    token: resetSession.accessToken,
    body: {
      currentPassword: 'incorrect-password',
      newPassword: portal.password,
    },
  });
  const finalPassword = `Changed-${randomBytes(16).toString('hex')}`;
  await expectStatus('/portal/auth/change-password', 204, {
    method: 'POST',
    token: resetSession.accessToken,
    body: { currentPassword: resetPassword, newPassword: finalPassword },
  });
  await expectStatus('/portal/auth/me', 401, {
    token: resetSession.accessToken,
  });
  await expectStatus('/portal/auth/refresh', 401, {
    method: 'POST',
    body: { refreshToken: resetSession.refreshToken },
  });
  await expectStatus('/portal/auth/login', 200, {
    method: 'POST',
    body: { username: portal.username, password: finalPassword },
  });
  pass(
    'Password changes require the current password and revoke every session',
  );
}

async function verifyPortalIsolation(portalToken, [storeA, storeB]) {
  const stores = await request('/portal/stores', { token: portalToken });
  if (
    stores.length !== 1 ||
    stores[0].id !== storeA.storeId ||
    stores.some((store) => store.id === storeB.storeId)
  ) {
    throw new Error('Portal store list leaked an unauthorized store.');
  }
  pass('Portal account lists only its assigned store');

  await expectStatus(`/portal/stores/${storeB.storeId}/sync-status`, 403, {
    token: portalToken,
  });
  pass('Portal account cannot read Store B synchronization status');

  await expectStatus(`/portal/stores/${storeB.storeId}/overview`, 403, {
    token: portalToken,
  });
  pass('Portal account cannot read Store B reports');

  await expectStatus(`/portal/stores/${storeB.storeId}/sales/1`, 403, {
    token: portalToken,
  });
  pass('Portal account cannot read Store B sale details');

  await expectStatus(
    `/portal/stores/${storeB.storeId}/exports/sales?from=2026-01-01&to=2026-12-31`,
    403,
    { token: portalToken },
  );
  pass('Portal account cannot export Store B reports');
}

async function verifyRejectedUploadsPreserveActive(store) {
  const baselineSnapshotId = store.snapshotId;
  const validBytes = await fs.readFile(store.databasePath);

  await expectStatus('/device-sync/sessions', 422, {
    method: 'POST',
    token: store.token,
    body: sessionRequest(validBytes, 999, 'unsupported-schema'),
    assert: (body) => assertErrorCode(body, 'SCHEMA_INCOMPATIBLE'),
  });
  await assertActiveSnapshot(store.token, baselineSnapshotId);
  pass('Unsupported schema is rejected without replacing active data');

  await expectStatus('/device-sync/sessions', 413, {
    method: 'POST',
    token: store.token,
    body: {
      ...sessionRequest(validBytes, 27, 'oversized-snapshot'),
      fileSize: maximumSnapshotBytes + 1,
    },
  });
  await assertActiveSnapshot(store.token, baselineSnapshotId);
  pass('Oversized declaration is rejected without replacing active data');

  const corruptBytes = randomBytes(4096);
  const corruptSession = await createSession(
    store.token,
    corruptBytes,
    'corrupt-snapshot',
  );
  await uploadBytes(store.token, corruptSession.id, corruptBytes, 200);
  await expectStatus(
    `/device-sync/sessions/${corruptSession.id}/complete`,
    422,
    {
      method: 'POST',
      token: store.token,
      assert: (body) => assertErrorCode(body, 'SNAPSHOT_INVALID'),
    },
  );
  await assertSessionRejected(store.token, corruptSession.id);
  await assertActiveSnapshot(store.token, baselineSnapshotId);
  pass('Corrupt database is rejected and previous snapshot remains active');

  const hashSession = await request('/device-sync/sessions', {
    method: 'POST',
    expectedStatus: 201,
    token: store.token,
    body: {
      ...sessionRequest(validBytes, 27, 'hash-mismatch'),
      sha256: '0'.repeat(64),
    },
  });
  await uploadBytes(store.token, hashSession.id, validBytes, 422);
  await assertSessionRejected(store.token, hashSession.id);
  await assertActiveSnapshot(store.token, baselineSnapshotId);
  pass('Checksum mismatch is rejected and previous snapshot remains active');

  const sizeSession = await request('/device-sync/sessions', {
    method: 'POST',
    expectedStatus: 201,
    token: store.token,
    body: {
      ...sessionRequest(validBytes, 27, 'size-mismatch'),
      fileSize: validBytes.length + 10,
      sha256: '1'.repeat(64),
    },
  });
  await uploadBytes(store.token, sizeSession.id, validBytes, 422);
  await expectStatus(`/device-sync/sessions/${sizeSession.id}`, 200, {
    token: store.token,
    assert: (body) => {
      if (body.status !== 'CREATED') {
        throw new Error(
          `Expected CREATED session after preflight size rejection, received ${body.status}.`,
        );
      }
    },
  });
  await expectStatus(`/device-sync/sessions/${sizeSession.id}`, 204, {
    method: 'DELETE',
    token: store.token,
  });
  await assertActiveSnapshot(store.token, baselineSnapshotId);
  pass(
    'Interrupted or short upload can be cancelled without replacing active data',
  );

  const duplicate = await request('/device-sync/sessions', {
    method: 'POST',
    expectedStatus: 201,
    token: store.token,
    body: sessionRequest(validBytes, 27, 'duplicate-snapshot'),
  });
  if (!duplicate.duplicate || duplicate.snapshotId !== baselineSnapshotId) {
    throw new Error(
      'Duplicate upload did not return the active snapshot safely.',
    );
  }
  await assertActiveSnapshot(store.token, baselineSnapshotId);
  pass('Duplicate upload resolves to the existing active snapshot');
}

async function verifyMissingSnapshotResponse(portalToken, store) {
  const activePath = join(
    snapshotRoot,
    'stores',
    store.storeId,
    'snapshots',
    `${store.snapshotId}.sqlite`,
  );
  const heldPath = `${activePath}.missing-test`;
  await fs.rename(activePath, heldPath);
  temporaryFiles.push({ activePath, heldPath });
  try {
    await expectStatus(`/portal/stores/${store.storeId}/overview`, 503, {
      token: portalToken,
      assert: (body) => assertErrorCode(body, 'SNAPSHOT_FILE_MISSING'),
    });
    pass(
      'Missing active snapshot returns service unavailable instead of zero totals',
    );
  } finally {
    await fs.rename(heldPath, activePath);
    temporaryFiles.pop();
  }
  await assertActiveSnapshot(store.token, store.snapshotId);
  pass('Missing-file test restores the valid active snapshot');
}

async function synchronize(token, path, applicationVersion) {
  const bytes = await fs.readFile(path);
  const session = await createSession(token, bytes, applicationVersion);
  await uploadBytes(token, session.id, bytes, 200);
  return request(`/device-sync/sessions/${session.id}/complete`, {
    method: 'POST',
    token,
  });
}

async function createSession(token, bytes, applicationVersion) {
  return request('/device-sync/sessions', {
    method: 'POST',
    expectedStatus: 201,
    token,
    body: sessionRequest(bytes, 27, applicationVersion),
  });
}

function sessionRequest(bytes, schemaVersion, applicationVersion) {
  return {
    schemaVersion,
    applicationVersion,
    snapshotCreatedAt: new Date().toISOString(),
    fileSize: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  };
}

async function uploadBytes(token, sessionId, bytes, expectedStatus) {
  const response = await fetch(
    `${apiUrl}/device-sync/sessions/${sessionId}/file`,
    {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/octet-stream',
        'Content-Length': String(bytes.length),
      },
      body: bytes,
    },
  );
  await assertResponseStatus(response, expectedStatus, 'Snapshot upload');
}

async function assertSessionRejected(token, sessionId) {
  const session = await request(`/device-sync/sessions/${sessionId}`, {
    token,
  });
  if (session.status !== 'REJECTED') {
    throw new Error(
      `Expected rejected session ${sessionId}, received ${session.status}.`,
    );
  }
}

async function assertActiveSnapshot(token, expectedSnapshotId) {
  const status = await request('/device-sync/status', { token });
  if (status.activeSnapshot?.id !== expectedSnapshotId) {
    throw new Error(
      `Active snapshot changed unexpectedly. Expected ${expectedSnapshotId}, received ${status.activeSnapshot?.id ?? 'none'}.`,
    );
  }
}

async function provisionTenants() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const now = new Date();
    await client.query(
      `INSERT INTO users (id, username, display_name, password_hash, role, status, updated_at)
       VALUES ($1, $2, 'Sync Security Test', 'not-used', 'SUPER_ADMIN', 'ACTIVE', $3)`,
      [ids.user, `${runId}-admin`, now],
    );
    await client.query(
      `INSERT INTO plans (id, code, name, status, updated_at)
       VALUES ($1, $2, 'Sync Security Test Plan', 'ACTIVE', $3)`,
      [ids.plan, `P-${runId}`.slice(-40), now],
    );
    await client.query(
      `INSERT INTO plan_versions
       (id, plan_id, version, billing_interval, amount, currency, trial_days, grace_days, max_devices, features, published_at)
       VALUES ($1, $2, 1, 'MONTHLY', 0, 'PHP', 0, 7, 1, '{}'::jsonb, $3)`,
      [ids.planVersion, ids.plan, now],
    );

    for (let index = 0; index < 2; index += 1) {
      await client.query(
        `INSERT INTO clients (id, code, business_name, status, updated_at)
         VALUES ($1, $2, $3, 'ACTIVE', $4)`,
        [
          ids.clients[index],
          `${runId}-${index + 1}`.slice(-40),
          `Security Tenant ${index + 1}`,
          now,
        ],
      );
      await client.query(
        `INSERT INTO stores (id, client_id, code, name, status, timezone, updated_at)
         VALUES ($1, $2, 'MAIN', $3, 'ACTIVE', 'Asia/Manila', $4)`,
        [
          ids.stores[index],
          ids.clients[index],
          `Security Store ${index + 1}`,
          now,
        ],
      );
      await client.query(
        `INSERT INTO subscriptions
         (id, client_id, plan_version_id, status, starts_at, expires_at, amount, currency,
          billing_interval, max_devices, entitlements, notes, created_by_id, updated_at)
         VALUES ($1, $2, $3, 'ACTIVE', $4, $5, 0, 'PHP', 'MONTHLY', 1, '{}'::jsonb, $6, $7, $4)`,
        [
          ids.subscriptions[index],
          ids.clients[index],
          ids.planVersion,
          new Date(now.getTime() - 86_400_000),
          new Date(now.getTime() + 86_400_000),
          runId,
          ids.user,
        ],
      );
      await client.query(
        `INSERT INTO devices
         (id, client_id, subscription_id, store_id, installation_id, label, platform, app_version, status, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, 'windows', 'sync-security-test', 'ACTIVE', $7)`,
        [
          ids.devices[index].id,
          ids.clients[index],
          ids.subscriptions[index],
          ids.stores[index],
          ids.devices[index].installationId,
          `Security Device ${index + 1}`,
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

function createStoreDatabase(path, storeNumber) {
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
    INSERT INTO schema_migrations VALUES (27, datetime('now'));
    INSERT INTO inventorytbl VALUES (1, 8, 2);
    INSERT INTO custinfo VALUES (1, 0, 'active');
    INSERT INTO pouttbl VALUES (1, datetime('now'));
  `);
  database
    .prepare(
      `INSERT INTO salestbl
       (salesid, salesrefnum, salestotalitem, salestotalamount, salestatus, salesdisc,
        salestotalcost, specialdisc, salesdate)
       VALUES (1, ?, 1, ?, 'COMPLETED', 0, ?, 0, datetime('now'))`,
    )
    .run(`SECURITY-STORE-${storeNumber}`, storeNumber * 100, storeNumber * 50);
  database.close();
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

async function cleanup() {
  for (const file of temporaryFiles.splice(0)) {
    await fs.rename(file.heldPath, file.activePath).catch(() => undefined);
  }
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
      `DELETE FROM portal_refresh_sessions
       WHERE portal_user_id IN (SELECT id FROM portal_users WHERE client_id = ANY($1::uuid[]))`,
      [ids.clients],
    );
    await client.query(
      `DELETE FROM portal_store_access WHERE store_id = ANY($1::uuid[])`,
      [ids.stores],
    );
    await client.query(
      `DELETE FROM portal_invitations WHERE store_id = ANY($1::uuid[])`,
      [ids.stores],
    );
    await client.query(
      `DELETE FROM portal_users WHERE client_id = ANY($1::uuid[])`,
      [ids.clients],
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

async function assertApiAvailable() {
  try {
    const response = await fetch(`${apiUrl}/health`);
    if (!response.ok) throw new Error(String(response.status));
  } catch {
    throw new Error(`Subscription API is not running at ${apiUrl}.`);
  }
}

async function request(path, options = {}) {
  const response = await send(path, options);
  await assertResponseStatus(
    response,
    options.expectedStatus ?? 200,
    `${options.method ?? 'GET'} ${path}`,
  );
  return response.status === 204 ? null : response.json();
}

async function expectStatus(path, status, options = {}) {
  const response = await send(path, options);
  await assertResponseStatus(
    response,
    status,
    `${options.method ?? 'GET'} ${path}`,
  );
  if (options.assert) options.assert(await response.json());
}

async function send(path, options) {
  const headers = { Accept: 'application/json', ...(options.headers ?? {}) };
  if (options.token) headers.Authorization = `Bearer ${options.token}`;
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  return fetch(`${apiUrl}${path}`, {
    method: options.method ?? 'GET',
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
}

async function assertResponseStatus(response, expected, label) {
  if (response.status === expected) return;
  let details = '';
  try {
    details = JSON.stringify(await response.json());
  } catch {
    details = await response.text().catch(() => '');
  }
  throw new Error(
    `${label} expected HTTP ${expected}, received ${response.status}${details ? `: ${details}` : ''}.`,
  );
}

function pass(name) {
  checks.push(name);
}

function assertErrorCode(body, expectedCode) {
  if (body.code !== expectedCode || typeof body.message !== 'string') {
    throw new Error(
      `Expected ${expectedCode} with a readable message, received ${JSON.stringify(body)}.`,
    );
  }
}
