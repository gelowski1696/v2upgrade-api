import { ConfigService } from '@nestjs/config';
import { SocialTokenVault } from './social-token-vault.js';

describe('SocialTokenVault', () => {
  it('encrypts without retaining plaintext and decrypts the credential', () => {
    const key = Buffer.alloc(32, 7).toString('base64');
    const vault = new SocialTokenVault(
      new ConfigService({ SOCIAL_TOKEN_ENCRYPTION_KEY: key }),
    );

    const encrypted = vault.encrypt('page-secret-token');

    expect(encrypted).toMatch(/^v1\./);
    expect(encrypted).not.toContain('page-secret-token');
    expect(vault.decrypt(encrypted)).toBe('page-secret-token');
  });

  it('rejects tampered ciphertext', () => {
    const key = Buffer.alloc(32, 9).toString('base64');
    const vault = new SocialTokenVault(
      new ConfigService({ SOCIAL_TOKEN_ENCRYPTION_KEY: key }),
    );
    const encrypted = vault.encrypt('page-secret-token');

    expect(() => vault.decrypt(`${encrypted}tampered`)).toThrow(
      'could not be opened',
    );
  });

  it('requires a 32-byte server key', () => {
    const vault = new SocialTokenVault(
      new ConfigService({ SOCIAL_TOKEN_ENCRYPTION_KEY: '' }),
    );

    expect(() => vault.encrypt('page-secret-token')).toThrow(
      'encryption is not configured',
    );
  });
});
