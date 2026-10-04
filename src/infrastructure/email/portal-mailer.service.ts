import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Resend, type WebhookEventPayload } from 'resend';

export interface PortalMail {
  to: string;
  subject: string;
  text: string;
  html: string;
  idempotencyKey: string;
  attachments?: Array<{
    filename: string;
    content: string | Buffer;
    contentType: string;
  }>;
}

@Injectable()
export class PortalMailerService {
  private readonly resend: Resend | null;
  private readonly from: string;
  private readonly webhookSecret: string;

  constructor(private readonly config: ConfigService) {
    const apiKey = this.config.get<string>('RESEND_API_KEY', '').trim();
    this.from = this.config.get<string>('RESEND_FROM_EMAIL', '').trim();
    this.webhookSecret = this.config
      .get<string>('RESEND_WEBHOOK_SECRET', '')
      .trim();
    this.resend = apiKey && this.from ? new Resend(apiKey) : null;
  }

  get configured(): boolean {
    return Boolean(this.resend && this.from);
  }

  async send(message: PortalMail): Promise<{ providerMessageId: string }> {
    if (!this.resend || !this.from) {
      throw new ServiceUnavailableException(
        'Email delivery is not configured for this server.',
      );
    }
    const { data, error } = await this.resend.emails.send(
      {
        from: this.from,
        to: message.to,
        subject: message.subject,
        text: message.text,
        html: message.html,
        attachments: message.attachments?.map((attachment) => ({
          filename: attachment.filename,
          content: Buffer.isBuffer(attachment.content)
            ? attachment.content
            : Buffer.from(attachment.content, 'utf8'),
          contentType: attachment.contentType,
        })),
      },
      { idempotencyKey: message.idempotencyKey },
    );
    if (error || !data?.id) {
      throw new ServiceUnavailableException(
        'Resend did not accept the email for delivery.',
      );
    }
    return { providerMessageId: data.id };
  }

  verifyWebhook(
    payload: string,
    headers: { id: string; timestamp: string; signature: string },
  ): WebhookEventPayload {
    if (!this.resend || !this.webhookSecret) {
      throw new ServiceUnavailableException(
        'Resend webhook verification is not configured for this server.',
      );
    }
    return this.resend.webhooks.verify({
      payload,
      headers,
      webhookSecret: this.webhookSecret,
    });
  }
}
