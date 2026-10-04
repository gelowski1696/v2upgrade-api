import { jest } from '@jest/globals';
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
        signatoryName: 'VON MC JIM A. MERCADO',
        signatoryTitle: 'SERVICE PROPRIETOR',
      },
    });

    expect(output.subarray(0, 4).toString()).toBe('%PDF');
    expect(output.length).toBeGreaterThan(1_000);
    expect(output.toString('latin1')).toContain('DejaVuSans-Bold');
    expect(
      output.toString('latin1').match(/\/Subtype\s*\/Image\b/g)?.length,
    ).toBeGreaterThanOrEqual(2);
    expect(new BillingStatementDocumentService()['money'](1200, 'PHP')).toBe(
      '₱1,200.00',
    );
  });

  it('does not create blank pages while adding page footers', async () => {
    const lines = Array.from({ length: 30 }, (_, index) => ({
      subscriptionId: `subscription-${index + 1}`,
      clientCode: `IGNO-${String(index + 1).padStart(4, '0')}`,
      ownerName: `Owner ${index + 1}`,
      businessName: `Store ${index + 1}`,
      address: null,
      planName: 'Gelo Testing',
      periodStartsAt: '2026-10-04T00:00:00.000Z',
      periodEndsAt: '2026-11-04T00:00:00.000Z',
      amount: 1200,
    }));
    const output = await new BillingStatementDocumentService().render({
      statementNumber: 'BS-20261004-PAGINATION',
      statementDate: '2026-10-04',
      dueDate: '2026-10-11',
      targetName: 'IGNO Clients',
      currency: 'PHP',
      totalAmount: 36_000,
      lines,
      company: {
        name: 'VMJAMTECH',
        address: 'Valenzuela City',
        email: 'billing@example.test',
        phone: '09123456789',
        paymentInstructions: [
          'ChinaBank: Account Name: Example, Account Number: 1234567890',
          'Send proof of payment to billing@example.test',
        ],
        signatoryName: 'VON MC JIM A. MERCADO',
        signatoryTitle: 'SERVICE PROPRIETOR',
      },
    });

    const pageObjects = output.toString('latin1').match(/\/Type\s*\/Page\b/g);
    expect(pageObjects).toHaveLength(3);
  });

  it('resets the cursor and gives payment instructions the full page width', () => {
    const service = new BillingStatementDocumentService();
    const text = jest.fn().mockReturnThis();
    const document = {
      x: 454,
      y: 100,
      page: { width: 595 },
      rect: jest.fn().mockReturnThis(),
      fill: jest.fn().mockReturnThis(),
      font: jest.fn().mockReturnThis(),
      fontSize: jest.fn().mockReturnThis(),
      fillColor: jest.fn().mockReturnThis(),
      text,
      moveDown: jest.fn().mockReturnThis(),
    } as unknown as PDFKit.PDFDocument;
    const input = {
      statementNumber: 'BS-20261004-12345678',
      statementDate: '2026-10-04',
      dueDate: '2026-10-11',
      targetName: 'IGNO Group',
      currency: 'PHP',
      totalAmount: 1638,
      lines: [],
      company: {
        name: 'VMJAMTECH',
        address: 'Valenzuela City',
        email: 'billing@example.test',
        phone: '09123456789',
        paymentInstructions: [],
        signatoryName: 'VON MC JIM A. MERCADO',
        signatoryTitle: 'SERVICE PROPRIETOR',
      },
    };

    service['drawTotal'](document, input);
    service['drawPaymentInstructions'](document, [
      'ChinaBank: Account Name: Example, Account Number: 1234567890',
    ]);

    expect(document.x).toBe(48);
    expect(text).toHaveBeenCalledWith('PAYMENT DETAILS', 48, 158, {
      width: 499,
    });
    expect(text).toHaveBeenCalledWith(
      'ChinaBank: Account Name: Example, Account Number: 1234567890',
      74,
      158,
      { width: 473, lineGap: 2 },
    );
  });
});
