import { jest } from '@jest/globals';
import { ConfigService } from '@nestjs/config';
import type { AuditWriter } from '../../domain/audit/audit-writer.js';
import { PrismaService } from '../../infrastructure/database/prisma.service.js';
import { PortalMailerService } from '../../infrastructure/email/portal-mailer.service.js';
import { BillingStatementDocumentService } from './billing-statement-document.service.js';
import { BillingStatementsService } from './billing-statements.service.js';

describe('BillingStatementsService', () => {
  let prisma: any;
  let mailer: any;
  let document: any;
  let audit: any;
  let service: BillingStatementsService;

  beforeEach(() => {
    prisma = {
      client: {
        findUnique: jest.fn().mockResolvedValue(clientWithSubscription()),
        update: jest.fn().mockResolvedValue({}),
      },
      clientGroup: {
        findUnique: jest.fn(),
        update: jest.fn().mockResolvedValue({}),
      },
      billingStatementDelivery: {
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn().mockResolvedValue({ id: 'delivery-12345678' }),
        update: jest.fn().mockResolvedValue({}),
      },
      $transaction: jest.fn(async (operations: Array<Promise<unknown>>) =>
        Promise.all(operations),
      ),
    };
    mailer = {
      configured: true,
      send: jest.fn().mockResolvedValue({ providerMessageId: 'email-one' }),
    };
    document = {
      render: jest.fn().mockResolvedValue(Buffer.from('%PDF-test')),
    };
    audit = { record: jest.fn().mockResolvedValue(undefined) };
    const config = {
      get: jest.fn((_key: string, fallback: string) => fallback),
    } as unknown as ConfigService;
    service = new BillingStatementsService(
      prisma as PrismaService,
      config,
      mailer as PortalMailerService,
      document as BillingStatementDocumentService,
      audit as AuditWriter,
    );
  });

  it('previews current subscription amounts and the remembered client email', async () => {
    await expect(
      service.preview({ targetType: 'CLIENT', targetId: 'client-one' }),
    ).resolves.toMatchObject({
      targetName: 'RFI LPG STORE',
      savedRecipientEmail: 'accounts@example.test',
      currency: 'PHP',
      totalAmount: 1638,
      emailConfigured: true,
      lines: [
        {
          clientCode: 'IGNO-0001',
          planName: 'LPG POS + Online Access',
          amount: 1638,
        },
      ],
    });
  });

  it('sends a generated PDF and remembers the normalized recipient', async () => {
    const result = await service.send(
      {
        targetType: 'CLIENT',
        targetId: 'client-one',
        recipientEmail: '  Billing@Example.Test ',
        rememberEmail: true,
        statementDate: '2026-10-04',
        dueDate: '2026-10-11',
        subject: 'October statement',
        message: 'Thank you.',
      },
      'admin-one',
    );

    expect(result).toMatchObject({
      status: 'SENT',
      recipientEmail: 'billing@example.test',
      providerMessageId: 'email-one',
    });
    expect(document.render).toHaveBeenCalledWith(
      expect.objectContaining({
        totalAmount: 1638,
        statementDate: '2026-10-04',
      }),
    );
    expect(mailer.send).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'billing@example.test',
        idempotencyKey: 'billing-statement/delivery-12345678',
        attachments: [
          expect.objectContaining({
            filename: 'billing-statement-IGNO-0001-2026-10-04.pdf',
            contentType: 'application/pdf',
            content: expect.any(Buffer),
          }),
        ],
      }),
    );
    expect(prisma.client.update).toHaveBeenCalledWith({
      where: { id: 'client-one' },
      data: { billingEmail: 'billing@example.test' },
    });
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'billing_statement.sent' }),
    );
  });

  it('rejects a due date before the statement date without creating a delivery', async () => {
    await expect(
      service.send(
        {
          targetType: 'CLIENT',
          targetId: 'client-one',
          recipientEmail: 'billing@example.test',
          rememberEmail: false,
          statementDate: '2026-10-04',
          dueDate: '2026-10-03',
          subject: 'October statement',
        },
        'admin-one',
      ),
    ).rejects.toThrow('due date cannot be earlier');
    expect(prisma.billingStatementDelivery.create).not.toHaveBeenCalled();
  });
});

function clientWithSubscription() {
  return {
    code: 'IGNO-0001',
    businessName: 'RFI LPG STORE',
    ownerName: 'ROCHELLE IGNO',
    address: 'Valenzuela City',
    email: 'owner@example.test',
    billingEmail: 'accounts@example.test',
    subscriptions: [
      {
        id: 'subscription-one',
        amount: { toString: () => '1638.00' },
        currency: 'PHP',
        startsAt: new Date('2026-10-01T00:00:00.000Z'),
        expiresAt: new Date('2026-10-31T00:00:00.000Z'),
        planVersion: { plan: { name: 'LPG POS + Online Access' } },
      },
    ],
  };
}
