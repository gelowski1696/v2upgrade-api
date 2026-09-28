import { config as loadEnvironment } from 'dotenv';
import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import pg from 'pg';

loadEnvironment();
if (process.env.NODE_ENV !== 'development') {
  throw new Error('Device rebinding is available only when NODE_ENV=development.');
}

const configPath = process.env.POSV2_DEVICE_CONFIG
  ?? join(process.env.APPDATA, 'com.vmjam.lpgpos', 'subscription-license.json');
const deviceConfig = JSON.parse(await fs.readFile(configPath, 'utf8'));
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const connection = await pool.connect();

try {
  await connection.query('BEGIN');
  const current = await connection.query(
    `SELECT id, installation_id
     FROM devices
     WHERE subscription_id IS NOT NULL AND status = 'ACTIVE'
     ORDER BY updated_at DESC
     LIMIT 1
     FOR UPDATE`,
  );
  if (current.rowCount !== 1) throw new Error('Expected one active subscribed development device.');
  const device = current.rows[0];
  await connection.query(
    'UPDATE devices SET installation_id = $1, updated_at = NOW() WHERE id = $2',
    [deviceConfig.deviceId, device.id],
  );
  await connection.query(
    `INSERT INTO audit_logs(id, action, resource_type, resource_id, metadata)
     VALUES ($1, $2, $3, $4, $5::jsonb)`,
    [
      randomUUID(),
      'device.development_rebound',
      'device',
      device.id,
      JSON.stringify({
        previousInstallationId: device.installation_id,
        installationId: deviceConfig.deviceId,
      }),
    ],
  );
  await connection.query('COMMIT');
  console.log(JSON.stringify({ deviceId: deviceConfig.deviceId, status: 'REGISTERED' }, null, 2));
} catch (error) {
  await connection.query('ROLLBACK');
  throw error;
} finally {
  connection.release();
  await pool.end();
}
