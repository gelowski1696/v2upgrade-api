import { Injectable } from '@nestjs/common';
import PDFDocument from 'pdfkit';
import { join } from 'node:path';
import {
  billingLogoPng,
  billingSignaturePng,
} from './billing-statement-assets.js';

const currencyBoldFont = join(
  process.cwd(),
  'node_modules',
  'dejavu-fonts-ttf',
  'ttf',
  'DejaVuSans-Bold.ttf',
);

export interface BillingStatementLine {
  subscriptionId: string;
  clientCode: string;
  ownerName: string | null;
  businessName: string;
  address: string | null;
  planName: string;
  periodStartsAt: string;
  periodEndsAt: string | null;
  amount: number;
}

export interface BillingStatementDocumentInput {
  statementNumber: string;
  statementDate: string;
  dueDate: string | null;
  targetName: string;
  currency: string;
  totalAmount: number;
  lines: BillingStatementLine[];
  company: {
    name: string;
    address: string;
    email: string;
    phone: string;
    paymentInstructions: string[];
    signatoryName: string;
    signatoryTitle: string;
  };
}

@Injectable()
export class BillingStatementDocumentService {
  async render(input: BillingStatementDocumentInput): Promise<Buffer> {
    const document = new PDFDocument({
      size: 'A4',
      margin: 48,
      bufferPages: true,
      info: {
        Title: `${input.targetName} billing statement`,
        Author: input.company.name,
        Subject: 'LPG POS System subscription billing statement',
      },
    });
    const chunks: Buffer[] = [];
    document.registerFont('Currency-Bold', currencyBoldFont);
    document.on('data', (chunk: Buffer) => chunks.push(chunk));
    const output = new Promise<Buffer>((resolve, reject) => {
      document.on('end', () => resolve(Buffer.concat(chunks)));
      document.on('error', reject);
    });

    this.drawCompanyHeader(document, input);
    this.drawStatementHeading(document, input);
    this.drawTableHeader(document);

    input.lines.forEach((line, index) => {
      if (document.y + 54 > document.page.height - 72) {
        document.addPage();
        this.drawCompanyHeader(document, input, true);
        this.drawTableHeader(document);
      }
      this.drawLine(document, line, index + 1, input.currency);
    });

    this.ensureSpace(document, input, 58);
    this.drawTotal(document, input);
    this.ensureSpace(
      document,
      input,
      72 + input.company.paymentInstructions.length * 30,
    );
    this.drawPaymentInstructions(document, input.company.paymentInstructions);
    this.ensureSpace(document, input, 96);
    this.drawSignature(document, input);

    const pages = document.bufferedPageRange();
    for (
      let index = pages.start;
      index < pages.start + pages.count;
      index += 1
    ) {
      document.switchToPage(index);
      const footer = `Statement ${input.statementNumber}  |  Page ${index + 1} of ${pages.count}`;
      document.font('Helvetica').fontSize(8).fillColor('#6b665b');
      const footerWidth = document.widthOfString(footer);
      document.text(
        footer,
        (document.page.width - footerWidth) / 2,
        document.page.height - 40,
        { lineBreak: false },
      );
    }

    document.end();
    return output;
  }

  private drawCompanyHeader(
    document: PDFKit.PDFDocument,
    input: BillingStatementDocumentInput,
    compact = false,
  ): void {
    const left = 48;
    const top = document.y;
    const logoWidth = compact ? 62 : 78;
    const logoHeight = compact ? 41 : 51;
    const dividerX = left + logoWidth + 12;
    const copyX = dividerX + 14;
    const copyWidth = 547 - copyX;
    const headerHeight = compact ? 45 : 58;

    document.image(billingLogoPng, left, top, {
      fit: [logoWidth, logoHeight],
      align: 'center',
      valign: 'center',
    });
    document
      .strokeColor('#456181')
      .lineWidth(1.2)
      .moveTo(dividerX, top)
      .lineTo(dividerX, top + headerHeight)
      .stroke();
    document
      .font('Helvetica-Bold')
      .fontSize(compact ? 13 : 17)
      .fillColor('#3f526d')
      .text(input.company.name, copyX, top + (compact ? 1 : 2), {
        width: copyWidth,
        height: compact ? 16 : 21,
        ellipsis: true,
      });
    document
      .font('Helvetica-Bold')
      .fontSize(compact ? 7.3 : 8.5)
      .fillColor('#4b5e77')
      .text(
        input.company.address || 'Subscription services',
        copyX,
        top + (compact ? 18 : 25),
        {
          width: copyWidth,
          height: compact ? 12 : 15,
          ellipsis: true,
        },
      );
    const contact = [input.company.email, input.company.phone]
      .filter(Boolean)
      .join('  |  ');
    if (contact) {
      document
        .font('Helvetica')
        .fontSize(compact ? 6.8 : 7.5)
        .fillColor('#6b665b')
        .text(contact, copyX, top + (compact ? 31 : 42), {
          width: copyWidth,
          height: 10,
          ellipsis: true,
        });
    }
    const ruleY = top + headerHeight + 8;
    document
      .strokeColor('#d6a84f')
      .lineWidth(1.5)
      .moveTo(left, ruleY)
      .lineTo(547, ruleY)
      .stroke();
    document.x = left;
    document.y = ruleY + (compact ? 9 : 12);
  }

  private ensureSpace(
    document: PDFKit.PDFDocument,
    input: BillingStatementDocumentInput,
    height: number,
  ): void {
    if (document.y + height <= document.page.height - 56) return;
    document.addPage();
    this.drawCompanyHeader(document, input, true);
  }

  private drawSignature(
    document: PDFKit.PDFDocument,
    input: BillingStatementDocumentInput,
  ): void {
    const left = 48;
    const top = document.y + 6;
    document
      .font('Helvetica')
      .fontSize(9)
      .fillColor('#4d493f')
      .text('Cordially yours,', left, top, { width: 180 });
    document.image(billingSignaturePng, left, top + 13, {
      fit: [140, 52],
      valign: 'bottom',
    });
    document
      .font('Helvetica-Bold')
      .fontSize(9.5)
      .fillColor('#11100d')
      .text(input.company.signatoryName, left, top + 62, {
        width: 220,
        height: 13,
        ellipsis: true,
      });
    document
      .font('Helvetica-Bold')
      .fontSize(8)
      .fillColor('#4d493f')
      .text(input.company.signatoryTitle, left, top + 75, {
        width: 220,
        height: 12,
        ellipsis: true,
      });
    document.x = left;
    document.y = top + 89;
  }

  private drawStatementHeading(
    document: PDFKit.PDFDocument,
    input: BillingStatementDocumentInput,
  ): void {
    document
      .font('Helvetica-Bold')
      .fontSize(17)
      .fillColor('#11100d')
      .text('Billing Statement for LPG POS System Subscription');
    document.moveDown(0.5);
    document.font('Helvetica').fontSize(9.5).fillColor('#4d493f');
    document.text(`Bill to: ${input.targetName}`);
    document.text(`Statement date: ${this.date(input.statementDate)}`);
    if (input.dueDate) document.text(`Due date: ${this.date(input.dueDate)}`);
    document.text(`Statement number: ${input.statementNumber}`);
    document.moveDown(0.8);
    document
      .fontSize(9)
      .text(
        'This statement lists the active LPG POS System subscriptions included in the current billing request.',
        { lineGap: 2 },
      );
    document.moveDown(1);
  }

  private drawTableHeader(document: PDFKit.PDFDocument): void {
    const y = document.y;
    document.rect(48, y, 499, 24).fill('#11100d');
    document.font('Helvetica-Bold').fontSize(8).fillColor('#ffffff');
    document.text('No.', 54, y + 8, { width: 24 });
    document.text('Client', 82, y + 8, { width: 118 });
    document.text('Store / location', 204, y + 8, { width: 145 });
    document.text('Plan / period', 353, y + 8, { width: 112 });
    document.text('Amount', 469, y + 8, { width: 70, align: 'right' });
    document.y = y + 24;
  }

  private drawLine(
    document: PDFKit.PDFDocument,
    line: BillingStatementLine,
    number: number,
    currency: string,
  ): void {
    const y = document.y;
    const height = 50;
    if (number % 2 === 0) document.rect(48, y, 499, height).fill('#faf5e9');
    document.font('Helvetica').fontSize(8.2).fillColor('#211f1a');
    document.text(String(number), 54, y + 8, { width: 24 });
    document
      .font('Helvetica-Bold')
      .text(line.ownerName || line.clientCode, 82, y + 8, {
        width: 118,
        height: 17,
        ellipsis: true,
      });
    document
      .font('Helvetica')
      .fontSize(7.5)
      .fillColor('#6b665b')
      .text(line.clientCode, 82, y + 27, {
        width: 118,
        height: 12,
        ellipsis: true,
      });
    document
      .font('Helvetica-Bold')
      .fontSize(8.2)
      .fillColor('#211f1a')
      .text(line.businessName, 204, y + 8, {
        width: 145,
        height: 17,
        ellipsis: true,
      });
    document
      .font('Helvetica')
      .fontSize(7.5)
      .fillColor('#6b665b')
      .text(line.address || 'No location recorded', 204, y + 27, {
        width: 145,
        height: 15,
        ellipsis: true,
      });
    document
      .font('Helvetica-Bold')
      .fontSize(8.2)
      .fillColor('#211f1a')
      .text(line.planName, 353, y + 8, {
        width: 112,
        height: 17,
        ellipsis: true,
      });
    document
      .font('Helvetica')
      .fontSize(7.2)
      .fillColor('#6b665b')
      .text(this.period(line.periodStartsAt, line.periodEndsAt), 353, y + 27, {
        width: 112,
        height: 15,
        ellipsis: true,
      });
    document
      .font('Currency-Bold')
      .fontSize(8.5)
      .fillColor('#211f1a')
      .text(this.money(line.amount, currency), 469, y + 8, {
        width: 70,
        align: 'right',
      });
    document
      .strokeColor('#e7dec9')
      .lineWidth(0.5)
      .moveTo(48, y + height)
      .lineTo(547, y + height)
      .stroke();
    document.y = y + height;
  }

  private drawTotal(
    document: PDFKit.PDFDocument,
    input: BillingStatementDocumentInput,
  ): void {
    document.moveDown(1);
    const y = document.y;
    document.rect(337, y, 210, 44).fill('#f0d78d');
    document
      .font('Helvetica-Bold')
      .fontSize(10)
      .fillColor('#11100d')
      .text('TOTAL AMOUNT DUE', 351, y + 9, {
        width: 105,
      });
    document
      .font('Currency-Bold')
      .fontSize(13)
      .text(this.money(input.totalAmount, input.currency), 454, y + 8, {
        width: 79,
        align: 'right',
      });
    document.x = 48;
    document.y = y + 58;
  }

  private drawPaymentInstructions(
    document: PDFKit.PDFDocument,
    instructions: string[],
  ): void {
    const left = 48;
    const width = document.page.width - 96;
    document.x = left;
    document
      .font('Helvetica-Bold')
      .fontSize(10)
      .fillColor('#11100d')
      .text('PAYMENT DETAILS', left, document.y, { width });
    document.moveDown(0.55);
    instructions.forEach((instruction, index) => {
      const itemY = document.y;
      document
        .font('Helvetica-Bold')
        .fontSize(8.8)
        .fillColor('#8c5e12')
        .text(`${index + 1}.`, left, itemY, { width: 22 });
      document
        .font('Helvetica')
        .fontSize(8.8)
        .fillColor('#4d493f')
        .text(instruction, left + 26, itemY, {
          width: width - 26,
          lineGap: 2,
        });
      document.x = left;
      document.y += 5;
    });
    document.moveDown(0.8);
    document
      .font('Helvetica')
      .fontSize(9)
      .fillColor('#4d493f')
      .text(
        'Thank you for your continued trust in our service. Please contact us if any billing detail needs clarification.',
        left,
        document.y,
        { width, lineGap: 2 },
      );
  }

  private date(value: string): string {
    return new Intl.DateTimeFormat('en-PH', {
      dateStyle: 'medium',
      timeZone: 'UTC',
    }).format(new Date(`${value.slice(0, 10)}T00:00:00.000Z`));
  }

  private period(from: string, to: string | null): string {
    const start = this.date(from.slice(0, 10));
    return to ? `${start} - ${this.date(to.slice(0, 10))}` : `From ${start}`;
  }

  private money(value: number, currency: string): string {
    return new Intl.NumberFormat('en-PH', {
      style: 'currency',
      currency,
      maximumFractionDigits: 2,
    }).format(value);
  }
}
