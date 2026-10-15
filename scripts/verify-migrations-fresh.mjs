import 'dotenv/config';
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import pg from 'pg';

const { Client } = pg;
const databaseName = `posv2_migration_verify_${randomBytes(4).toString('hex')}`;
if (!/^[a-z][a-z0-9_]+$/.test(databaseName)) {
  throw new Error('Unsafe verification database name.');
}

const sourceUrl = process.env.DATABASE_URL;
if (!sourceUrl) throw new Error('DATABASE_URL is required.');

const adminUrl = new URL(sourceUrl);
adminUrl.pathname = '/postgres';
const verificationUrl = new URL(sourceUrl);
verificationUrl.pathname = `/${databaseName}`;

const admin = new Client({ connectionString: adminUrl.toString() });
let connected = false;

try {
  await admin.connect();
  connected = true;
  await dropVerificationDatabase(admin);
  await admin.query(`CREATE DATABASE "${databaseName}"`);

  const result = spawnSync(
    process.execPath,
    [
      join(process.cwd(), 'node_modules', 'prisma', 'build', 'index.js'),
      'migrate',
      'deploy',
      '--config',
      'prisma7.config.ts',
    ],
    {
      cwd: process.cwd(),
      env: { ...process.env, DATABASE_URL: verificationUrl.toString() },
      stdio: 'inherit',
    },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`Migration deployment exited with code ${result.status}.`);
  }
  console.log('Fresh-database migration verification passed.');
} finally {
  if (connected) {
    await dropVerificationDatabase(admin);
    await admin.end().catch(() => undefined);
  }
}

async function dropVerificationDatabase(client) {
  await client.query(
    `SELECT pg_terminate_backend(pid)
       FROM pg_stat_activity
      WHERE datname = $1 AND pid <> pg_backend_pid()`,
    [databaseName],
  );
  await client.query(`DROP DATABASE IF EXISTS "${databaseName}"`);
}
