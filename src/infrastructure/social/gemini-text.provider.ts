import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface CaptionGenerationRequest {
  template: string;
  facts: Record<string, string>;
  tone: string;
  language: string;
}

export interface CaptionGenerationResult {
  variants: string[];
  provider: string;
  model: string;
  fallback: boolean;
}

@Injectable()
export class GeminiTextProvider {
  constructor(private readonly config: ConfigService) {}

  async generateCaptions(
    request: CaptionGenerationRequest,
  ): Promise<CaptionGenerationResult> {
    const fallback = this.fallbackVariants(request);
    const apiKey = this.config.get<string>('GEMINI_API_KEY') ?? '';
    const model =
      this.config.get<string>('GEMINI_MODEL') ?? 'gemini-2.5-flash-lite';
    if (!apiKey) {
      return {
        variants: fallback,
        provider: 'TEMPLATE',
        model: 'none',
        fallback: true,
      };
    }

    const prompt = [
      'Write exactly three Facebook Page caption variants.',
      'Use only the supplied facts. Do not invent prices, dates, stock, discounts, safety claims, or contact details.',
      `Language: ${request.language || 'English'}`,
      `Tone: ${request.tone || 'clear and helpful'}`,
      `Template: ${request.template}`,
      `Approved facts: ${JSON.stringify(request.facts)}`,
      'Return JSON only: {"variants":["...","...","..."]}',
    ].join('\n');

    try {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: {
              responseMimeType: 'application/json',
              temperature: 0.7,
              maxOutputTokens: 900,
            },
          }),
          signal: AbortSignal.timeout(20_000),
        },
      );
      if (!response.ok) throw new Error('Gemini request failed');
      const body = (await response.json()) as {
        candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
      };
      const text = body.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
      const parsed = JSON.parse(text) as { variants?: unknown };
      const variants = Array.isArray(parsed.variants)
        ? parsed.variants
            .filter((value): value is string => typeof value === 'string')
            .map((value) => value.trim())
            .filter(Boolean)
            .slice(0, 3)
        : [];
      if (!variants.length) throw new Error('Gemini returned no captions');
      return { variants, provider: 'GEMINI', model, fallback: false };
    } catch {
      return {
        variants: fallback,
        provider: 'TEMPLATE',
        model,
        fallback: true,
      };
    }
  }

  private fallbackVariants(request: CaptionGenerationRequest): string[] {
    const render = (template: string): string =>
      Object.entries(request.facts).reduce(
        (result, [key, value]) => result.replaceAll(`{{${key}}}`, value.trim()),
        template,
      );
    const base = render(request.template).trim();
    return [
      base,
      `${base}\n\nMessage us for details.`,
      `${base}\n\nThank you for choosing us.`,
    ].filter((value, index, all) => value && all.indexOf(value) === index);
  }
}
