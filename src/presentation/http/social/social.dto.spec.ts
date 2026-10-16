import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { SaveFaqDto } from './social.dto.js';

describe('SaveFaqDto', () => {
  it('accepts validated FAQ match keywords', async () => {
    const input = plainToInstance(SaveFaqDto, {
      actor: 'admin',
      connectionId: '10000000-0000-4000-8000-000000000001',
      question: 'What are your store hours?',
      answer: 'We are open Monday to Saturday.',
      keywords: ['hours', 'open', 'close'],
      enabled: true,
    });

    const errors = await validate(input, {
      whitelist: true,
      forbidNonWhitelisted: true,
    });

    expect(errors).toHaveLength(0);
    expect(input.keywords).toEqual(['hours', 'open', 'close']);
  });
});
