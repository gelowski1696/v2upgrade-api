import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../generated/prisma/client.js';

async function main(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL is required.');

  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString }),
  });
  try {
    const subscriptions = await prisma.subscription.findMany({
      where: {
        deletedAt: null,
        events: {
          some: {
            reason: { contains: 'renew', mode: 'insensitive' },
          },
        },
      },
      select: {
        id: true,
        startsAt: true,
        expiresAt: true,
        createdAt: true,
        client: { select: { code: true, businessName: true } },
        events: {
          orderBy: { createdAt: 'asc' },
          take: 1,
          select: { createdAt: true },
        },
      },
      orderBy: { createdAt: 'asc' },
    });

    const candidates = subscriptions
      .map((subscription) => {
        const firstEventAt =
          subscription.events[0]?.createdAt ?? subscription.createdAt;
        const differenceDays = Math.floor(
          (subscription.startsAt.getTime() - firstEventAt.getTime()) /
            86_400_000,
        );
        return {
          subscriptionId: subscription.id,
          clientCode: subscription.client.code,
          businessName: subscription.client.businessName,
          storedStartsAt: subscription.startsAt.toISOString(),
          firstRecordedAt: firstEventAt.toISOString(),
          expiresAt: subscription.expiresAt?.toISOString() ?? null,
          differenceDays,
        };
      })
      .filter((record) => record.differenceDays > 0);

    console.log(
      JSON.stringify(
        {
          generatedAt: new Date().toISOString(),
          reviewedSubscriptions: subscriptions.length,
          candidates: candidates.length,
          note: 'Review candidates manually. Scheduled future starts can be valid; this command never changes data.',
          records: candidates,
        },
        null,
        2,
      ),
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
