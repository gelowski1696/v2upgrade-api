import { ConfigService } from '@nestjs/config';
import { GeminiTextProvider } from './gemini-text.provider.js';

describe('GeminiTextProvider', () => {
  it('renders an approved template when no API key is configured', async () => {
    const provider = new GeminiTextProvider(new ConfigService({}));

    const result = await provider.generateCaptions({
      template: '{{store_name}} delivers in {{area}}.',
      facts: { store_name: 'VMJAM LPG', area: 'Bacolod' },
      tone: 'helpful',
      language: 'English',
    });

    expect(result.fallback).toBe(true);
    expect(result.provider).toBe('TEMPLATE');
    expect(result.variants[0]).toBe('VMJAM LPG delivers in Bacolod.');
  });
});
