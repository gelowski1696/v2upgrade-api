import { Injectable } from '@nestjs/common';
import * as argon2 from 'argon2';
import type { PasswordHasher } from '../../domain/auth/password-hasher.js';

@Injectable()
export class Argon2PasswordHasher implements PasswordHasher {
  hash(value: string): Promise<string> {
    return argon2.hash(value, { type: argon2.argon2id });
  }

  verify(hash: string, value: string): Promise<boolean> {
    return argon2.verify(hash, value);
  }
}
