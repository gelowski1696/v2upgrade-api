import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import * as argon2 from 'argon2';
import { PrismaClient, UserRole } from '../../generated/prisma/client.js';

async function main(): Promise<void> {
  const [rawUsername, password] = process.argv.slice(2);
  if (!rawUsername || !password) {
    throw new Error(
      'Usage: npm run admin:reset-password -- <username> <password>',
    );
  }
  if (password.length < 12) {
    throw new Error(
      'Administrator password must contain at least 12 characters.',
    );
  }

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL is required.');
  }

  const username = rawUsername.trim().toLowerCase();
  const adapter = new PrismaPg({ connectionString });
  const prisma = new PrismaClient({ adapter });

  try {
    const existing = await prisma.user.findUnique({ where: { username } });
    if (!existing) {
      throw new Error(`Administrator "${username}" does not exist.`);
    }
    if (
      existing.role !== UserRole.SUPER_ADMIN &&
      existing.role !== UserRole.ADMIN
    ) {
      throw new Error(`User "${username}" is not an administrator.`);
    }

    const passwordHash = await argon2.hash(password, {
      type: argon2.argon2id,
    });
    const revokedAt = new Date();
    const result = await prisma.$transaction(async (transaction) => {
      const user = await transaction.user.update({
        where: { id: existing.id },
        data: { passwordHash },
        select: { id: true, username: true, role: true, status: true },
      });
      const sessions = await transaction.refreshSession.updateMany({
        where: { userId: user.id, revokedAt: null },
        data: { revokedAt },
      });
      await transaction.auditLog.create({
        data: {
          action: 'admin.password_reset_cli',
          resourceType: 'user',
          resourceId: user.id,
          metadata: {
            username: user.username,
            revokedSessions: sessions.count,
          },
        },
      });
      return { user, revokedSessions: sessions.count };
    });

    console.log(
      `Reset password for ${result.user.role} account ${result.user.username}; ` +
        `revoked ${result.revokedSessions} active session(s). ` +
        `Status: ${result.user.status}.`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
