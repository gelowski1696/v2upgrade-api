import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  CreateCampaignDto,
  GeneratePostDto,
  SaveFaqDto,
  SaveQuoteDto,
} from './social.dto.js';

describe('GeneratePostDto', () => {
  it('accepts the authenticated desktop actor field', async () => {
    const input = plainToInstance(GeneratePostDto, {
      actor: 'admin',
      connectionId: '10000000-0000-4000-8000-000000000001',
      template: 'Create a post for {{store_name}}.',
      facts: { store_name: 'Example Store' },
      tone: 'clear and helpful',
      language: 'English',
    });

    const errors = await validate(input, {
      whitelist: true,
      forbidNonWhitelisted: true,
    });

    expect(errors).toHaveLength(0);
    expect(input.actor).toBe('admin');
  });
});

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

describe('SaveQuoteDto', () => {
  it('accepts an itemized quote and rejects client-only properties', async () => {
    const valid = plainToInstance(SaveQuoteDto, {
      actor: 'cashier',
      connectionId: '10000000-0000-4000-8000-000000000001',
      conversationId: '20000000-0000-4000-8000-000000000002',
      lines: [
        {
          posItemId: 17,
          itemCode: 'LPG-11',
          itemName: '11kg LPG',
          itemSize: '11kg',
          unit: 'REFILL',
          quantity: 2,
          unitPriceMinor: 190000,
        },
      ],
      notes: 'Deliver tomorrow.',
      idempotencyKey: 'quote-request-1',
    });
    const invalid = plainToInstance(SaveQuoteDto, {
      ...valid,
      totalMinor: 1,
    });

    expect(
      await validate(valid, { whitelist: true, forbidNonWhitelisted: true }),
    ).toHaveLength(0);
    expect(
      await validate(invalid, { whitelist: true, forbidNonWhitelisted: true }),
    ).not.toHaveLength(0);
  });
});

describe('CreateCampaignDto', () => {
  it('limits campaigns to three reviewed variants', async () => {
    const campaign = plainToInstance(CreateCampaignDto, {
      actor: 'manager',
      connectionId: '10000000-0000-4000-8000-000000000001',
      name: 'Healthy stock feature',
      goal: 'Increase qualified Messenger inquiries',
      facts: { product_name: '11kg LPG', price: '₱1,900.00' },
      variants: ['One', 'Two', 'Three', 'Four'],
      selectedVariant: 0,
    });

    const errors = await validate(campaign, {
      whitelist: true,
      forbidNonWhitelisted: true,
    });
    expect(errors.some((error) => error.property === 'variants')).toBe(true);
  });
});
