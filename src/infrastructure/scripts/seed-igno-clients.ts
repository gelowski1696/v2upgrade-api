import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import {
  ClientGroupStatus,
  ClientStatus,
  PrismaClient,
  StoreStatus,
  UserRole,
  UserStatus,
} from '../../generated/prisma/client.js';

type LegacyClient = {
  name: string;
  store: string;
  deviceId: string;
};

const GROUP_CODE = 'IGNO';
const GROUP_NAME = 'IGNO Clients';
const SEED_MARKER = 'Seed batch: IGNO legacy import 2026-10-03';

const legacyClients: readonly LegacyClient[] = [
  {
    name: 'ROCHELLE IGNO',
    store: 'RFI LPG STORE',
    deviceId: 'C01E7E4C-3068-11B2-A85C-C9E0216CB38D',
  },
  {
    name: 'ROBERTO STA. ANA',
    store: 'TAYTAY LPG TRADING',
    deviceId: '22E4FBFB-8402-11E9-8B14-A06610C018AF',
  },
  {
    name: 'LEONORA B. SORIANO',
    store: 'LEONORA LPG TRADING',
    deviceId: '02409591-842F-11E9-8B14-A06610C0248C',
  },
  {
    name: 'JOAN UMBAL',
    store: 'JOAN LPG STORE',
    deviceId: 'C9B081EC-83FA-11E9-8B14-A06610C0119C',
  },
  {
    name: 'JOAQUIN NAVIA BOBIS',
    store: 'J.N.B LPG STORE',
    deviceId: '6E6114CC-8401-11E9-8B14-A06610C0188D',
  },
  {
    name: 'REGIEROLD RIVADINERA',
    store: 'RLR LPG STORE (CALUMPANG)',
    deviceId: '03000200-0400-0500-0006-000700080009',
  },
  {
    name: 'OLIVIA RAMOS',
    store: 'PAKIL LPG TRADING',
    deviceId: '819D047B-EB4F-CB11-90B6-FEB10EB668FE',
  },
  {
    name: 'JUMAR EQUIZ',
    store: 'JOMS LPG TRADING',
    deviceId: '0D787001-50C4-11CB-AE62-E800F06262F8',
  },
  {
    name: 'HONESTO P. IBLOGIN',
    store: "IBLOGIN'S LPG STORE (BARAS)",
    deviceId: 'EC5FA881-5450-11CB-8530-F8BAF15F758B',
  },
  {
    name: 'OLIVIA RAMOS',
    store: 'PAT LPG STORE',
    deviceId: 'ED94D381-5458-11CB-9875-8E3A425A9D46',
  },
  {
    name: 'MARIA VITO',
    store: 'TANAY LPG STORE',
    deviceId: '8E2EC781-5448-11CB-B379-A2C38AD3D3AE',
  },
  {
    name: 'JOAQUIN BOBIS',
    store: 'KAPATID LPG TRADING',
    deviceId: '05864A81-548D-11CB-98CE-9630A9C275D2',
  },
  {
    name: 'MANUEL CANETE',
    store: 'CANETE LPG STORE',
    deviceId: 'EB784801-544B-11CB-8CAB-97CD160FDF16',
  },
  {
    name: 'MICHAEL PERNITO',
    store: 'PERNITO LPG TRADING',
    deviceId: '401BC301-544C-11CB-AC96-B96D8D0747DD',
  },
  {
    name: 'JUMAR EQUIZ',
    store: 'ISLANO GAS TRADING',
    deviceId: '03000200-0400-0500-0006-0007000800091',
  },
  {
    name: 'JOAN UMBAL',
    store: 'JRU LPG STORE',
    deviceId: '03000200-0400-0500-0006-0007000800092',
  },
  {
    name: 'IGNO GHQ',
    store: 'GHQ',
    deviceId: '03000200-0400-0500-0006-0007000800093',
  },
  {
    name: 'OLIVIA RAMOS',
    store: 'STR LPG STORE',
    deviceId: '03000200-0400-0500-0006-0007000800094',
  },
  {
    name: 'ANTONIO DANILO BONUS VELASCO',
    store: 'VELASCO SUPPLY',
    deviceId: '03000200-0400-0500-0006-0007000800095',
  },
  {
    name: 'LEILANIE DUHAYLUNGSOD',
    store: 'DUHAY LUNGSOD LPG STORE',
    deviceId: '03000200-0400-0500-0006-0007000800096',
  },
  {
    name: 'JUMAR EQUIZ III',
    store: 'JUMAR EQUIZ LPG SUPPLY',
    deviceId: '03000200-0400-0500-0006-0007000800097',
  },
  {
    name: 'MANUEL FERROL CANETE II',
    store: 'CANETE LPG STORE II',
    deviceId: '03000200-0400-0500-0006-0007000800098',
  },
  {
    name: 'ROCHELLE IGNO II',
    store: 'RFI LPG STORE II',
    deviceId: '03000200-0400-0500-0006-0007000800099',
  },
  {
    name: 'REMELITO MATIONG',
    store: 'OMICRON LPG TRADING',
    deviceId: '03000200-0400-0500-0006-0007000800100',
  },
  {
    name: 'OLIVIA RAMOS IV',
    store: 'TMR LPG STORE',
    deviceId: '03000200-0400-0500-0006-0007000800101',
  },
  {
    name: 'ROMELITO MATIONG II',
    store: 'OMICRON LPG TRADING II',
    deviceId: '03000200-0400-0500-0006-0007000800102',
  },
  {
    name: 'MANUEL FERROL CANETE III',
    store: 'FAMY LPG',
    deviceId: '03000200-0400-0500-0006-0007000800103',
  },
  {
    name: 'PRINCESS JOY TAN',
    store: 'SINILOAN LAGUNA SINILOAN LPG',
    deviceId: '03000200-0400-0500-0006-0007000800104',
  },
  {
    name: 'MANUEL FERROL CANETE IIII',
    store: 'MANUEL LPG',
    deviceId: '03000200-0400-0500-0006-0007000800105',
  },
  {
    name: 'JOAN UMBAL III',
    store: 'J.U LP GASTORE LPG STORE',
    deviceId: '03000200-0400-0500-0006-0007000800106',
  },
];

function clientCode(index: number): string {
  return `${GROUP_CODE}-${String(index + 1).padStart(4, '0')}`;
}

function validateSeedData(): void {
  if (legacyClients.length !== 30) {
    throw new Error(`Expected 30 IGNO clients, found ${legacyClients.length}.`);
  }

  const deviceIds = new Set<string>();
  legacyClients.forEach((client, index) => {
    if (
      !client.name.trim() ||
      !client.store.trim() ||
      !client.deviceId.trim()
    ) {
      throw new Error(`${clientCode(index)} contains an empty required field.`);
    }
    const normalizedDeviceId = client.deviceId.trim().toUpperCase();
    if (deviceIds.has(normalizedDeviceId)) {
      throw new Error(`Duplicate device ID: ${client.deviceId}`);
    }
    deviceIds.add(normalizedDeviceId);
  });
}

function buildNotes(existingNotes: string | null, deviceId: string): string {
  const retainedLines = (existingNotes ?? '')
    .split(/\r?\n/)
    .filter(
      (line) =>
        !line.startsWith('Legacy device ID:') && line.trim() !== SEED_MARKER,
    );
  const retained = retainedLines.join('\n').trim();
  const imported = `Legacy device ID: ${deviceId}\n${SEED_MARKER}`;
  return retained ? `${retained}\n\n${imported}` : imported;
}

async function main(): Promise<void> {
  validateSeedData();
  const apply = process.argv.slice(2).includes('--apply');
  const records = legacyClients.map((client, index) => ({
    code: clientCode(index),
    businessName: client.store,
    ownerName: client.name,
    deviceId: client.deviceId,
  }));

  if (!apply) {
    console.log(
      JSON.stringify(
        {
          mode: 'DRY_RUN',
          message: 'No database changes were made. Run again with --apply.',
          group: { code: GROUP_CODE, name: GROUP_NAME },
          total: records.length,
          records,
        },
        null,
        2,
      ),
    );
    return;
  }

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString)
    throw new Error('DATABASE_URL is required with --apply.');

  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString }),
  });

  try {
    const requestedActor =
      process.env.SEED_ACTOR_USERNAME?.trim().toLowerCase();
    const actor = requestedActor
      ? await prisma.user.findFirst({
          where: {
            username: requestedActor,
            status: UserStatus.ACTIVE,
            role: { in: [UserRole.SUPER_ADMIN, UserRole.ADMIN] },
          },
          select: { id: true, username: true },
        })
      : ((await prisma.user.findFirst({
          where: {
            status: UserStatus.ACTIVE,
            role: UserRole.SUPER_ADMIN,
          },
          orderBy: { createdAt: 'asc' },
          select: { id: true, username: true },
        })) ??
        (await prisma.user.findFirst({
          where: { status: UserStatus.ACTIVE, role: UserRole.ADMIN },
          orderBy: { createdAt: 'asc' },
          select: { id: true, username: true },
        })));

    if (!actor) {
      throw new Error(
        requestedActor
          ? `Active administrator "${requestedActor}" was not found.`
          : 'An active SUPER_ADMIN or ADMIN is required to create the IGNO group.',
      );
    }

    const result = await prisma.$transaction(
      async (tx) => {
        const group = await tx.clientGroup.upsert({
          where: { code: GROUP_CODE },
          create: {
            code: GROUP_CODE,
            name: GROUP_NAME,
            description: 'Imported legacy IGNO client accounts.',
            status: ClientGroupStatus.ACTIVE,
            createdById: actor.id,
          },
          update: {
            name: GROUP_NAME,
            description: 'Imported legacy IGNO client accounts.',
            status: ClientGroupStatus.ACTIVE,
          },
          select: { id: true, code: true, name: true },
        });

        let created = 0;
        let updated = 0;

        for (const [index, source] of legacyClients.entries()) {
          const code = clientCode(index);
          const existing = await tx.client.findUnique({
            where: { code },
            select: { id: true, businessName: true, notes: true },
          });

          if (
            existing &&
            !existing.notes?.includes(SEED_MARKER) &&
            existing.businessName !== source.store
          ) {
            throw new Error(
              `${code} already belongs to "${existing.businessName}". No records were changed.`,
            );
          }

          const notes = buildNotes(existing?.notes ?? null, source.deviceId);
          const client = existing
            ? await tx.client.update({
                where: { id: existing.id },
                data: {
                  businessName: source.store,
                  ownerName: source.name,
                  notes,
                  status: ClientStatus.ACTIVE,
                  groupId: group.id,
                },
                select: { id: true },
              })
            : await tx.client.create({
                data: {
                  code,
                  businessName: source.store,
                  ownerName: source.name,
                  notes,
                  status: ClientStatus.ACTIVE,
                  groupId: group.id,
                },
                select: { id: true },
              });

          await tx.store.upsert({
            where: { clientId_code: { clientId: client.id, code: 'MAIN' } },
            create: {
              clientId: client.id,
              code: 'MAIN',
              name: source.store,
              status: StoreStatus.ACTIVE,
              timezone: 'Asia/Manila',
            },
            update: {
              name: source.store,
              status: StoreStatus.ACTIVE,
              timezone: 'Asia/Manila',
            },
          });

          if (existing) updated += 1;
          else created += 1;
        }

        await tx.auditLog.create({
          data: {
            actorId: actor.id,
            action: 'clients.igno_seeded',
            resourceType: 'client_import',
            resourceId: group.id,
            metadata: {
              groupCode: GROUP_CODE,
              created,
              updated,
              total: legacyClients.length,
            },
          },
        });

        return { group, created, updated };
      },
      { maxWait: 10_000, timeout: 30_000 },
    );

    console.log(
      JSON.stringify(
        {
          mode: 'APPLY',
          result: 'PASS',
          actor: actor.username,
          group: result.group,
          created: result.created,
          updated: result.updated,
          total: legacyClients.length,
          note: 'Legacy device IDs were retained in client notes; no subscriptions or device bindings were created.',
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
