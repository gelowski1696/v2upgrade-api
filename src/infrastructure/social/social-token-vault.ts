import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

@Injectable()
export class SocialTokenVault {
  constructor(private readonly config: ConfigService) {}

  encrypt(value: string): string {
    const key = this.key();
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    const encrypted = Buffer.concat([
      cipher.update(value, 'utf8'),
      cipher.final(),
    ]);
    return [
      'v1',
      iv.toString('base64url'),
      cipher.getAuthTag().toString('base64url'),
      encrypted.toString('base64url'),
    ].join('.');
  }

  decrypt(value: string): string {
    const [version, encodedIv, encodedTag, encodedValue] = value.split('.');
    if (version !== 'v1' || !encodedIv || !encodedTag || !encodedValue) {
      throw new ServiceUnavailableException(
        'The saved social credential is invalid. Reconnect the Facebook Page.',
      );
    }
    try {
      const decipher = createDecipheriv(
        'aes-256-gcm',
        this.key(),
        Buffer.from(encodedIv, 'base64url'),
      );
      decipher.setAuthTag(Buffer.from(encodedTag, 'base64url'));
      return Buffer.concat([
        decipher.update(Buffer.from(encodedValue, 'base64url')),
        decipher.final(),
      ]).toString('utf8');
    } catch {
      throw new ServiceUnavailableException(
        'The saved social credential could not be opened. Reconnect the Facebook Page.',
      );
    }
  }

  private key(): Buffer {
    const value = this.config.get<string>('SOCIAL_TOKEN_ENCRYPTION_KEY') ?? '';
    let key: Buffer;
    try {
      key = Buffer.from(value, 'base64');
    } catch {
      key = Buffer.alloc(0);
    }
    if (key.length !== 32) {
      throw new ServiceUnavailableException(
        'Social credential encryption is not configured on the server.',
      );
    }
    return key;
  }
}
