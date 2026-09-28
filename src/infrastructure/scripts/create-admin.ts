import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import * as argon2 from 'argon2';
import {
  PrismaClient,
  UserRole,
  UserStatus,
} from '../../generated/prisma/client.js';

async function main(): Promise<void> {
  const [rawUsername, password, rawDisplayName] = process.argv.slice(2);
  if (!rawUsername || !password) {
    throw new Error(
      'Usage: npm run admin:create -- <username> <password> [display name]',
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
    if (existing) {
      throw new Error(`User "${username}" already exists.`);
    }

    const user = await prisma.user.create({
      data: {
        username,
        displayName: rawDisplayName?.trim() || 'System Administrator',
        passwordHash: await argon2.hash(password, { type: argon2.argon2id }),
        role: UserRole.SUPER_ADMIN,
        status: UserStatus.ACTIVE,
      },
      select: { id: true, username: true, displayName: true, role: true },
    });
    console.log(`Created ${user.role} account: ${user.username} (${user.id})`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
