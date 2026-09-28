import { createHash, randomBytes } from 'node:crypto';
import { createReadStream, promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';

const appData = process.env.APPDATA;
if (!appData) throw new Error('APPDATA is unavailable.');

const dataPath = process.env.POSV2_DATABASE_PATH
  ?? join(appData, 'com.vmjam.lpgpos', 'vmjampos.vmjamtechdata');
const configPath = process.env.POSV2_DEVICE_CONFIG
  ?? join(appData, 'com.vmjam.lpgpos', 'subscription-license.json');
const snapshotPath = join(tmpdir(), `posv2-owner-sync-${process.pid}.sqlite`);
let deviceToken = '';
let temporaryUserId = '';
let database;

try {
  const config = JSON.parse(await fs.readFile(configPath, 'utf8'));
  const apiUrl = String(config.apiUrl).replace(/\/$/, '');
  await createSnapshot(dataPath, snapshotPath);
  database = new Database(snapshotPath, { readonly: true, fileMustExist: true });
  const schemaVersion = Number(database.prepare('SELECT MAX(version) AS version FROM schema_migrations').get().version);
  const integrity = String(database.pragma('quick_check', { simple: true }));
  if (integrity.toLowerCase() !== 'ok') throw new Error(`Snapshot integrity failed: ${integrity}`);

  const license = await request(apiUrl, '/licenses/validate', {
    method: 'POST',
    body: { deviceId: config.deviceId },
  });
  if (!license.valid || !license.deviceAccessToken) throw new Error(license.message ?? 'Device is not registered.');
  deviceToken = license.deviceAccessToken;

  const stat = await fs.stat(snapshotPath);
  const sha256 = await hashFile(snapshotPath);
  const session = await request(apiUrl, '/device-sync/sessions', {
    method: 'POST',
    token: deviceToken,
    body: {
      schemaVersion,
      applicationVersion: 'owner-sync-verification',
      snapshotCreatedAt: new Date().toISOString(),
      fileSize: stat.size,
      sha256,
    },
  });

  if (!session.duplicate) {
    const upload = await fetch(`${apiUrl}/device-sync/sessions/${session.id}/file`, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${deviceToken}`,
        'Content-Type': 'application/octet-stream',
        'Content-Length': String(stat.size),
      },
      body: createReadStream(snapshotPath),
      duplex: 'half',
    });
    if (!upload.ok) throw new Error(await responseMessage(upload, 'Snapshot upload failed.'));
    await request(apiUrl, `/device-sync/sessions/${session.id}/complete`, {
      method: 'POST',
      token: deviceToken,
    });
  }

  const syncStatus = await request(apiUrl, '/device-sync/status', { token: deviceToken });
  if (!syncStatus.activeSnapshot) throw new Error('The uploaded snapshot was not activated.');

  const suffix = `${Date.now()}-${randomBytes(3).toString('hex')}`;
  const invitation = await request(apiUrl, '/device-portal/invitations', {
    method: 'POST',
    token: deviceToken,
    body: {
      username: `owner-sync-${suffix}@local.test`,
      displayName: 'Owner Sync Verification',
      role: 'OWNER',
    },
  });
  const activation = await request(apiUrl, '/portal/auth/activate', {
    method: 'POST',
    body: { token: invitation.activationToken, password: `Owner-${randomBytes(12).toString('hex')}` },
  });
  temporaryUserId = activation.user.id;

  const stores = await request(apiUrl, '/portal/stores', { token: activation.accessToken });
  const store = stores.find((value) => value.id === syncStatus.storeId);
  if (!store) throw new Error('The activated owner cannot access the synchronized store.');

  const from = '2000-01-01';
  const to = '2099-12-31';
  const dashboard = await request(
    apiUrl,
    `/portal/stores/${store.id}/overview?from=${from}&to=${to}`,
    { token: activation.accessToken },
  );
  const expected = desktopSalesTotals(database, from, to);
  assertTotals(dashboard.data, expected);
  database.close();
  database = undefined;

  await request(apiUrl, `/device-portal/users/${temporaryUserId}/disable`, {
    method: 'POST',
    token: deviceToken,
  });
  temporaryUserId = '';

  console.log(JSON.stringify({
    result: 'PASS',
    store: syncStatus.storeName,
    storeId: syncStatus.storeId,
    snapshotId: syncStatus.activeSnapshot.id,
    schemaVersion: syncStatus.activeSnapshot.schemaVersion,
    snapshotSizeMb: Number((stat.size / 1_048_576).toFixed(2)),
    duplicateUpload: Boolean(session.duplicate),
    comparedRange: { from, to },
    totals: expected,
    portalAccount: 'activated, verified, and disabled',
  }, null, 2));
} finally {
  if (database?.open) database.close();
  if (temporaryUserId && deviceToken) {
    try {
      const config = JSON.parse(await fs.readFile(configPath, 'utf8'));
      await request(String(config.apiUrl).replace(/\/$/, ''), `/device-portal/users/${temporaryUserId}/disable`, {
        method: 'POST',
        token: deviceToken,
      });
    } catch {}
  }
  await fs.rm(snapshotPath, { force: true, maxRetries: 3, retryDelay: 100 });
}

async function createSnapshot(source, target) {
  const database = new Database(source, { readonly: true, fileMustExist: true });
  try {
    database.exec(`VACUUM INTO '${target.replaceAll("'", "''")}'`);
  } finally {
    database.close();
  }
}

async function hashFile(path) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}

async function request(baseUrl, path, options = {}) {
  const headers = { Accept: 'application/json' };
  if (options.token) headers.Authorization = `Bearer ${options.token}`;
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  const response = await fetch(`${baseUrl}${path}`, {
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

function desktopSalesTotals(database, from, to) {
  const sales = database.prepare(`
    SELECT COUNT(*) AS transactionCount,
      CAST(COALESCE(SUM(salestotalamount), 0) AS REAL) AS grossSales,
      CAST(COALESCE(SUM(salesdisc + specialdisc), 0) AS REAL) AS discounts,
      CAST(COALESCE(SUM(salestotalcost), 0) AS REAL) AS costOfGoods
    FROM salestbl
    WHERE salesdate >= ? AND salesdate < datetime(?, '+1 day')
      AND UPPER(COALESCE(salestatus, '')) <> 'CANCELLED'
  `).get(from, to);
  const customer = database.prepare(`
    SELECT COUNT(*) AS customersWithBalance,
      CAST(COALESCE(SUM(custbalance), 0) AS REAL) AS customerBalance
    FROM custinfo
    WHERE custbalance > 0 AND COALESCE(custstatus, 'active') <> 'inactive'
  `).get();
  const inventoryItems = Number(database.prepare('SELECT COUNT(*) AS count FROM inventorytbl').get().count);
  const criticalItems = Number(database.prepare('SELECT COUNT(*) AS count FROM inventorytbl WHERE fillqty <= alertnum').get().count);
  const transfers = Number(database.prepare("SELECT COUNT(*) AS count FROM pouttbl WHERE pulldate >= ? AND pulldate < datetime(?, '+1 day')").get(from, to).count);
  return {
    transactionCount: Number(sales.transactionCount),
    grossSales: Number(sales.grossSales),
    discounts: Number(sales.discounts),
    costOfGoods: Number(sales.costOfGoods),
    grossProfit: Number(sales.grossSales) - Number(sales.costOfGoods),
    customerBalance: Number(customer.customerBalance),
    customersWithBalance: Number(customer.customersWithBalance),
    inventoryItems,
    criticalItems,
    transfers,
  };
}

function assertTotals(actual, expected) {
  for (const [key, expectedValue] of Object.entries(expected)) {
    const actualValue = Number(actual[key]);
    if (!Number.isFinite(actualValue) || Math.abs(actualValue - expectedValue) > 0.005) {
      throw new Error(`Dashboard parity failed for ${key}: expected ${expectedValue}, received ${actual[key]}.`);
    }
  }
}
