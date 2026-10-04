import { BillingStatementDocumentService } from './billing-statement-document.service.js';

describe('BillingStatementDocumentService', () => {
  it('renders a non-empty PDF attachment', async () => {
    const output = await new BillingStatementDocumentService().render({
      statementNumber: 'BS-20261004-12345678',
      statementDate: '2026-10-04',
      dueDate: '2026-10-11',
      targetName: 'IGNO Group',
      currency: 'PHP',
      totalAmount: 1638,
      lines: [
        {
          subscriptionId: 'subscription-one',
          clientCode: 'IGNO-0001',
          ownerName: 'ROCHELLE IGNO',
          businessName: 'RFI LPG STORE',
          address: 'Valenzuela City',
          planName: 'LPG POS + Online Access',
          periodStartsAt: '2026-10-01T00:00:00.000Z',
          periodEndsAt: '2026-10-31T00:00:00.000Z',
          amount: 1638,
        },
      ],
      company: {
        name: 'VMJAMTECH',
        address: 'Valenzuela City',
        email: 'billing@example.test',
        phone: '09123456789',
        paymentInstructions: ['Contact us for payment instructions.'],
      },
    });

    expect(output.subarray(0, 4).toString()).toBe('%PDF');
    expect(output.length).toBeGreaterThan(1_000);
  });
});
