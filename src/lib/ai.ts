// Claude görsel analizi ile fotoğrafın çekildiği ülke/şehri tahmin etme.
import Anthropic from '@anthropic-ai/sdk';
import * as SecureStore from 'expo-secure-store';

export const MODEL = 'claude-opus-5-5';
const KEY_NAME = 'anthropic_api_key';

export class AIUnavailable extends Error {}

export interface LocationGuess {
  country: string;
  country_code: string | null;
  city: string | null;
  landmark: string | null;
  description: string;
  confidence: number;
  reasoning: string;
}

const SYSTEM_PROMPT = `Sen bir seyahat fotoğrafı konum uzmanısın. Sana bir fotoğraf verilecek; fotoğrafın çekildiği ülkeyi ve şehri tespit et.

İpuçları: tanınmış yapılar ve simgeler, tabelalar ve yazı dili, plakalar, mimari tarz, bitki örtüsü, coğrafya, trafik yönü, kıyafetler, yemekler.

Kurallar:
- Ülke ve şehir adlarını Türkçe yaz (ör. "İtalya", "Roma", "Almanya", "Münih").
- Şehri kestiremiyorsan city alanını null bırak; uydurma.
- Ülkeyi de kestiremiyorsan country alanına "Bilinmiyor" yaz ve confidence 0 olsun.
- confidence 0 ile 1 arasında, ne kadar emin olduğunu gösterir.
- description fotoğrafı 1 cümleyle Türkçe anlatsın.
- reasoning tahminine dayanak olan ipuçlarını kısaca açıklasın.`;

const nullableString = { anyOf: [{ type: 'string' }, { type: 'null' }] };

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['country', 'country_code', 'city', 'landmark', 'description', 'confidence', 'reasoning'],
  properties: {
    country: { type: 'string', description: 'Ülke adı (Türkçe)' },
    country_code: { ...nullableString, description: 'ISO 3166-1 alpha-2 ülke kodu, ör. IT' },
    city: { ...nullableString, description: 'Şehir adı (Türkçe) veya null' },
    landmark: { ...nullableString, description: 'Görünen önemli yer/yapı adı veya null' },
    description: { type: 'string', description: 'Fotoğrafın tek cümlelik açıklaması' },
    confidence: { type: 'number', description: '0-1 arası güven' },
    reasoning: { type: 'string', description: 'Kısa gerekçe' },
  },
};

export async function getApiKey(): Promise<string | null> {
  return SecureStore.getItemAsync(KEY_NAME);
}

export async function setApiKey(key: string): Promise<void> {
  const k = key.trim();
  if (k) await SecureStore.setItemAsync(KEY_NAME, k);
  else await SecureStore.deleteItemAsync(KEY_NAME);
}

export async function detectLocation(jpegBase64: string, hint?: string): Promise<LocationGuess> {
  const apiKey = await getApiKey();
  if (!apiKey) throw new AIUnavailable('Claude API anahtarı girilmemiş. Ayarlar’dan ekleyin.');

  // Anahtar yalnızca bu telefonda (güvenli depoda) saklanır ve doğrudan Anthropic'e gönderilir.
  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true, maxRetries: 2 });

  let text = 'Bu fotoğraf hangi ülkede ve hangi şehirde çekilmiş?';
  if (hint) text += `\nEk bilgi: ${hint}`;

  let response;
  try {
    response = await client.beta.messages.create({
      model: MODEL,
      max_tokens: 4000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'low', format: { type: 'json_schema', schema: SCHEMA } },
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: jpegBase64 } },
            { type: 'text', text },
          ],
        },
      ],
    });
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) throw new AIUnavailable('Claude API anahtarı geçersiz.');
    if (err instanceof Anthropic.RateLimitError) throw new AIUnavailable('İstek sınırına ulaşıldı, biraz sonra tekrar deneyin.');
    if (err instanceof Anthropic.APIConnectionError) throw new AIUnavailable('İnternet bağlantısı yok veya Claude’a ulaşılamadı.');
    if (err instanceof Anthropic.APIError) throw new AIUnavailable(`Claude API hatası (${err.status}): ${err.message}`);
    throw err;
  }

  if (response.stop_reason === 'refusal') throw new AIUnavailable('Yapay zekâ bu fotoğraf için tahmin yapmadı.');
  const block = response.content.find((b) => b.type === 'text');
  if (!block || block.type !== 'text') throw new AIUnavailable('Yapay zekâdan cevap alınamadı.');

  let guess: LocationGuess;
  try {
    guess = JSON.parse(block.text);
  } catch {
    throw new AIUnavailable('Yapay zekâ cevabı okunamadı.');
  }
  guess.confidence = Math.max(0, Math.min(1, Number(guess.confidence) || 0));
  guess.country_code = guess.country_code ? guess.country_code.toUpperCase().slice(0, 2) : null;
  return guess;
}
