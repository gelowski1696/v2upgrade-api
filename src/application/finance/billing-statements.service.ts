import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Prisma } from '../../generated/prisma/client.js';
import {
  AUDIT_WRITER,
  type AuditWriter,
} from '../../domain/audit/audit-writer.js';
import { PrismaService } from '../../infrastructure/database/prisma.service.js';
import { PortalMailerService } from '../../infrastructure/email/portal-mailer.service.js';
import type {
  BillingStatementPreviewQueryDto,
  SendBillingStatementDto,
} from '../../presentation/http/finance/finance.dto.js';
import {
  BillingStatementDocumentService,
  type BillingStatementDocumentInput,
  type BillingStatementLine,
} from './billing-statement-document.service.js';

type BillingTarget = {
  targetType: 'CLIENT' | 'GROUP';
  targetId: string;
  targetCode: string;
  targetName: string;
  savedRecipientEmail: string | null;
  lines: BillingStatementLine[];
  currency: string;
  totalAmount: number;
};

@Injectable()
export class BillingStatementsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly mailer: PortalMailerService,
    private readonly document: BillingStatementDocumentService,
    @Inject(AUDIT_WRITER) private readonly audit: AuditWriter,
  ) {}

  async preview(input: BillingStatementPreviewQueryDto) {
    const target = await this.target(input.targetType, input.targetId);
    const recentDeliveries =
      await this.prisma.billingStatementDelivery.findMany({
        where:
          input.targetType === 'CLIENT'
            ? { clientId: input.targetId }
            : { groupId: input.targetId },
        orderBy: { createdAt: 'desc' },
        take: 5,
        select: {
          id: true,
          recipientEmail: true,
          subject: true,
          statementDate: true,
          dueDate: true,
          totalAmount: true,
          currency: true,
          status: true,
          providerStatus: true,
          sentAt: true,
          deliveredAt: true,
          createdAt: true,
        },
      });
    return {
      ...target,
      company: this.company(),
      emailConfigured: this.mailer.configured,
      defaultSubject: `${this.monthLabel(this.today())} LPG POS System Billing Statement - ${target.targetName}`,
      recentDeliveries: recentDeliveries.map((delivery) => ({
        ...delivery,
        totalAmount: delivery.totalAmount.toFixed(2),
      })),
    };
  }

  async send(input: SendBillingStatementDto, actorId: string) {
    if (input.dueDate && input.dueDate < input.statementDate) {
      throw new BadRequestException(
        'The due date cannot be earlier than the statement date.',
      );
    }
    const target = await this.target(input.targetType, input.targetId);
    const recipientEmail = input.recipientEmail.trim().toLowerCase();
    const subject = input.subject.trim();
    const company = this.company();
    const delivery = await this.prisma.billingStatementDelivery.create({
      data: {
        targetType: input.targetType,
        clientId: input.targetType === 'CLIENT' ? input.targetId : null,
        groupId: input.targetType === 'GROUP' ? input.targetId : null,
        recipientEmail,
        subject,
        statementDate: input.statementDate,
        dueDate: input.dueDate || null,
        currency: target.currency,
        totalAmount: target.totalAmount,
        lineItems: target.lines as unknown as Prisma.InputJsonValue,
        createdById: actorId,
      },
      select: { id: true },
    });
    const statementNumber = this.statementNumber(
      input.statementDate,
      delivery.id,
    );

    try {
      const documentInput: BillingStatementDocumentInput = {
        statementNumber,
        statementDate: input.statementDate,
        dueDate: input.dueDate || null,
        targetName: target.targetName,
        currency: target.currency,
        totalAmount: target.totalAmount,
        lines: target.lines,
        company,
      };
      const attachment = await this.document.render(documentInput);
      const message = await this.mailer.send({
        to: recipientEmail,
        subject,
        text: this.textEmail(input, target, company, statementNumber),
        html: this.htmlEmail(input, target, company, statementNumber),
        idempotencyKey: `billing-statement/${delivery.id}`,
        attachments: [
          {
            filename: `billing-statement-${this.safeFileName(target.targetCode)}-${input.statementDate}.pdf`,
            content: attachment,
            contentType: 'application/pdf',
          },
        ],
      });
      const sentAt = new Date();
      await this.prisma.$transaction([
        this.prisma.billingStatementDelivery.update({
          where: { id: delivery.id },
          data: {
            status: 'SENT',
            providerMessageId: message.providerMessageId,
            providerStatus: 'email.sent',
            sentAt,
            errorCode: null,
          },
        }),
        ...(input.rememberEmail
          ? [
              input.targetType === 'CLIENT'
                ? this.prisma.client.update({
                    where: { id: input.targetId },
                    data: { billingEmail: recipientEmail },
                  })
                : this.prisma.clientGroup.update({
                    where: { id: input.targetId },
                    data: { billingEmail: recipientEmail },
                  }),
            ]
          : []),
      ]);
      await this.audit.record({
        actorId,
        action: 'billing_statement.sent',
        resourceType: 'billing_statement_delivery',
        resourceId: delivery.id,
        metadata: {
          targetType: input.targetType,
          targetId: input.targetId,
          lineCount: target.lines.length,
          totalAmount: target.totalAmount,
          currency: target.currency,
          rememberedEmail: input.rememberEmail,
        },
      });
      return {
        id: delivery.id,
        statementNumber,
        status: 'SENT' as const,
        providerMessageId: message.providerMessageId,
        recipientEmail,
        sentAt,
      };
    } catch (error) {
      await this.prisma.billingStatementDelivery.update({
        where: { id: delivery.id },
        data: { status: 'FAILED', errorCode: 'BILLING_EMAIL_SEND_FAILED' },
      });
      await this.audit.record({
        actorId,
        action: 'billing_statement.failed',
        resourceType: 'billing_statement_delivery',
        resourceId: delivery.id,
        metadata: {
          targetType: input.targetType,
          targetId: input.targetId,
          errorCode: 'BILLING_EMAIL_SEND_FAILED',
        },
      });
      throw error;
    }
  }

  private async target(
    targetType: 'CLIENT' | 'GROUP',
    targetId: string,
  ): Promise<BillingTarget> {
    const subscriptionSelect = {
      id: true,
      amount: true,
      currency: true,
      startsAt: true,
      expiresAt: true,
      planVersion: { select: { plan: { select: { name: true } } } },
    } as const;
    let targetCode: string;
    let targetName: string;
    let savedRecipientEmail: string | null;
    let sourceLines: Array<{
      client: {
        code: string;
        ownerName: string | null;
        businessName: string;
        address: string | null;
      };
      subscription: {
        id: string;
        amount: { toString(): string };
        currency: string;
        startsAt: Date;
        expiresAt: Date | null;
        planVersion: { plan: { name: string } };
      };
    }>;

    if (targetType === 'CLIENT') {
      const client = await this.prisma.client.findUnique({
        where: { id: targetId },
        select: {
          code: true,
          businessName: true,
          ownerName: true,
          address: true,
          email: true,
          billingEmail: true,
          subscriptions: {
            where: {
              deletedAt: null,
              status: { in: ['ACTIVE', 'GRACE', 'TRIAL'] },
            },
            orderBy: { createdAt: 'asc' },
            select: subscriptionSelect,
          },
        },
      });
      if (!client) throw new NotFoundException('Client not found.');
      targetCode = client.code;
      targetName = client.businessName;
      savedRecipientEmail = client.billingEmail ?? client.email;
      sourceLines = client.subscriptions.map((subscription) => ({
        client,
        subscription,
      }));
    } else {
      const group = await this.prisma.clientGroup.findUnique({
        where: { id: targetId },
        select: {
          code: true,
          name: true,
          billingEmail: true,
          clients: {
            where: { status: 'ACTIVE' },
            orderBy: { businessName: 'asc' },
            select: {
              code: true,
              businessName: true,
              ownerName: true,
              address: true,
              subscriptions: {
                where: {
                  deletedAt: null,
                  status: { in: ['ACTIVE', 'GRACE', 'TRIAL'] },
                },
                orderBy: { createdAt: 'asc' },
                select: subscriptionSelect,
              },
            },
          },
        },
      });
      if (!group) throw new NotFoundException('Client group not found.');
      targetCode = group.code;
      targetName = group.name;
      savedRecipientEmail = group.billingEmail;
      sourceLines = group.clients.flatMap((client) =>
        client.subscriptions.map((subscription) => ({ client, subscription })),
      );
    }

    if (!sourceLines.length) {
      throw new BadRequestException(
        'No active, trial, or grace-period subscriptions are available for this billing statement.',
      );
    }
    const currencies = new Set(
      sourceLines.map(({ subscription }) => subscription.currency),
    );
    if (currencies.size !== 1) {
      throw new BadRequestException(
        'All subscriptions in one billing statement must use the same currency.',
      );
    }
    const lines: BillingStatementLine[] = sourceLines.map(
      ({ client, subscription }) => ({
        subscriptionId: subscription.id,
        clientCode: client.code,
        ownerName: client.ownerName,
        businessName: client.businessName,
        address: client.address,
        planName: subscription.planVersion.plan.name,
        periodStartsAt: subscription.startsAt.toISOString(),
        periodEndsAt: subscription.expiresAt?.toISOString() ?? null,
        amount: Number(subscription.amount),
      }),
    );
    return {
      targetType,
      targetId,
      targetCode,
      targetName,
      savedRecipientEmail,
      lines,
      currency: [...currencies][0] ?? 'PHP',
      totalAmount: this.money(
        lines.reduce((total, line) => total + line.amount, 0),
      ),
    };
  }

  private company(): BillingStatementDocumentInput['company'] {
    return {
      name: this.value('BILLING_COMPANY_NAME', 'VMJAMTECH'),
      address: this.value(
        'BILLING_COMPANY_ADDRESS',
        'Felo 1 Subdivision, Barangay Rincon Street, Valenzuela City, Metro Manila',
      ),
      email: this.value('BILLING_SUPPORT_EMAIL', 'vmjamtech@gmail.com'),
      phone: this.value('BILLING_SUPPORT_PHONE', '0976-0960-101'),
      paymentInstructions: this.value(
        'BILLING_PAYMENT_INSTRUCTIONS',
        'Please contact VMJAMTECH for the current bank or e-wallet payment details.',
      )
        .split('|')
        .map((item) => item.trim())
        .filter(Boolean),
      signatoryName: this.value(
        'BILLING_SIGNATORY_NAME',
        'VON MC JIM A. MERCADO',
      ),
      signatoryTitle: this.value(
        'BILLING_SIGNATORY_TITLE',
        'SERVICE PROPRIETOR',
      ),
    };
  }

  private htmlEmail(
    input: SendBillingStatementDto,
    target: BillingTarget,
    company: BillingStatementDocumentInput['company'],
    statementNumber: string,
  ): string {
    const message = input.message?.trim();
    const rows = target.lines
      .map(
        (line) => `<tr>
          <td style="padding:10px 0;border-bottom:1px solid #e7dec9">${this.escape(line.businessName)}<br><span style="color:#756e60;font-size:12px">${this.escape(line.clientCode)} · ${this.escape(line.planName)}</span></td>
          <td style="padding:10px 0;border-bottom:1px solid #e7dec9;text-align:right;font-weight:700">${this.escape(this.formatMoney(line.amount, target.currency))}</td>
        </tr>`,
      )
      .join('');
    return `<!doctype html><html><body style="margin:0;background:#fff8ea;color:#11100d;font-family:Arial,sans-serif">
      <div style="max-width:640px;margin:0 auto;padding:32px 20px">
        <p style="margin:0 0 24px;color:#a16d12;font-size:12px;font-weight:700;letter-spacing:.06em">${this.escape(company.name)}</p>
        <h1 style="margin:0;font-size:26px;line-height:1.2">LPG POS System Billing Statement</h1>
        <p style="margin:8px 0 24px;color:#665f52">Statement ${this.escape(statementNumber)} for ${this.escape(target.targetName)}</p>
        ${message ? `<p style="line-height:1.6">${this.escape(message).replace(/\n/g, '<br>')}</p>` : ''}
        <table style="width:100%;border-collapse:collapse;margin:24px 0">${rows}</table>
        <div style="border-top:2px solid #11100d;padding-top:14px;text-align:right">
          <span style="color:#665f52">Total amount due</span><br>
          <strong style="font-size:24px">${this.escape(this.formatMoney(target.totalAmount, target.currency))}</strong>
        </div>
        <p style="margin:28px 0 0;line-height:1.6;color:#665f52">The full statement and payment details are attached as a PDF.</p>
        <p style="margin:24px 0 0;font-size:12px;color:#756e60">${this.escape(company.address)}<br>${this.escape([company.email, company.phone].filter(Boolean).join(' · '))}</p>
      </div>
    </body></html>`;
  }

  private textEmail(
    input: SendBillingStatementDto,
    target: BillingTarget,
    company: BillingStatementDocumentInput['company'],
    statementNumber: string,
  ): string {
    return [
      company.name,
      'LPG POS System Billing Statement',
      `Statement: ${statementNumber}`,
      `Bill to: ${target.targetName}`,
      `Statement date: ${input.statementDate}`,
      input.dueDate ? `Due date: ${input.dueDate}` : '',
      '',
      input.message?.trim() ?? '',
      '',
      ...target.lines.map(
        (line) =>
          `${line.businessName} (${line.clientCode}) - ${line.planName}: ${this.formatMoney(line.amount, target.currency)}`,
      ),
      '',
      `Total amount due: ${this.formatMoney(target.totalAmount, target.currency)}`,
      'The full statement and payment details are attached as a PDF.',
      '',
      [company.email, company.phone].filter(Boolean).join(' | '),
    ]
      .filter((line, index, lines) => line || lines[index - 1])
      .join('\n');
  }

  private value(key: string, fallback: string): string {
    return this.config.get<string>(key, fallback).trim() || fallback;
  }

  private today(): string {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Manila',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());
  }

  private monthLabel(value: string): string {
    return new Intl.DateTimeFormat('en-PH', {
      month: 'long',
      year: 'numeric',
      timeZone: 'UTC',
    }).format(new Date(`${value}T00:00:00.000Z`));
  }

  private statementNumber(date: string, id: string): string {
    return `BS-${date.replaceAll('-', '')}-${id.slice(0, 8).toUpperCase()}`;
  }

  private safeFileName(value: string): string {
    return (
      value.replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'client'
    );
  }

  private formatMoney(value: number, currency: string): string {
    return new Intl.NumberFormat('en-PH', {
      style: 'currency',
      currency,
      maximumFractionDigits: 2,
    }).format(value);
  }

  private money(value: number): number {
    return Math.round((value + Number.EPSILON) * 100) / 100;
  }

  private escape(value: string): string {
    return value
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }
}
