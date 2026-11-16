// Saf (platformdan bağımsız) yardımcılar — birim testleri bu dosyayı doğrudan çalıştırır.

export type Source = 'gps' | 'ai' | 'manuel' | 'bilinmiyor';

/** GPS'i olmayan ve yapay zekânın da bakmadığı fotoğrafların toplandığı bölüm. */
export const UNKNOWN_COUNTRY = 'Konumu bilinmeyen';

export interface Photo {
  id: number;
  key: string;
  uri: string;
  country: string;
  countryCode: string | null;
  city: string | null;
  landmark: string | null;
  description: string | null;
  latitude: number | null;
  longitude: number | null;
  takenAt: string | null;
  source: Source;
  confidence: number | null;
  reasoning: string | null;
  addedAt: string;
}

export interface Coords {
  latitude: number;
  longitude: number;
}

/** "41/1,53/1,2412/100" veya [41, 53, 24.12] veya 41.89 → ondalık derece */
function toDegrees(value: unknown): number | null {
  if (value == null) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const parts: unknown[] = Array.isArray(value) ? value : String(value).split(',');
  const nums = parts.map((p) => {
    if (typeof p === 'number') return p;
    const [a, b] = String(p).trim().split('/');
    const n = Number(a);
    const d = b === undefined ? 1 : Number(b);
    return d ? n / d : NaN;
  });
  if (nums.some((n) => !Number.isFinite(n)) || nums.length === 0) return null;
  const [d, m = 0, s = 0] = nums;
  return d + m / 60 + s / 3600;
}

/** iOS ({GPS} sözlüğü) ve Android (GPSLatitude…) EXIF biçimlerinden koordinat okur. */
export function gpsFromExif(exif: Record<string, any> | null | undefined): Coords | null {
  if (!exif) return null;
  const ios = exif['{GPS}'];
  let lat: number | null;
  let lon: number | null;
  let latRef: string | undefined;
  let lonRef: string | undefined;
  if (ios && typeof ios === 'object') {
    lat = toDegrees(ios.Latitude);
    lon = toDegrees(ios.Longitude);
    latRef = ios.LatitudeRef;
    lonRef = ios.LongitudeRef;
  } else {
    lat = toDegrees(exif.GPSLatitude);
    lon = toDegrees(exif.GPSLongitude);
    latRef = exif.GPSLatitudeRef;
    lonRef = exif.GPSLongitudeRef;
  }
  if (lat == null || lon == null) return null;
  if (latRef?.toUpperCase().startsWith('S') && lat > 0) lat = -lat;
  if (lonRef?.toUpperCase().startsWith('W') && lon > 0) lon = -lon;
  if (lat === 0 && lon === 0) return null;
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  return { latitude: Math.round(lat * 1e6) / 1e6, longitude: Math.round(lon * 1e6) / 1e6 };
}

/** "2024:07:15 18:30:05" → "2024-07-15T18:30:05" */
export function takenAtFromExif(exif: Record<string, any> | null | undefined): string | null {
  if (!exif) return null;
  const raw = exif['{Exif}']?.DateTimeOriginal ?? exif.DateTimeOriginal ?? exif.DateTime;
  if (typeof raw !== 'string') return null;
  const m = raw.trim().match(/^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}` : null;
}

export const OTHER_CITY = 'Diğer';

export interface CountryGroup {
  country: string;
  countryCode: string | null;
  count: number;
  cover: Photo;
  cities: { city: string; photos: Photo[] }[];
}

/** Fotoğrafları Ülke → Şehir olarak gruplar; en çok fotoğraflı ülke önce. */
export function groupPhotos(photos: Photo[]): CountryGroup[] {
  const byCountry = new Map<string, Photo[]>();
  for (const p of photos) {
    const list = byCountry.get(p.country) ?? [];
    list.push(p);
    byCountry.set(p.country, list);
  }
  const groups: CountryGroup[] = [];
  for (const [country, list] of byCountry) {
    const byCity = new Map<string, Photo[]>();
    for (const p of list) {
      const c = p.city || OTHER_CITY;
      byCity.set(c, [...(byCity.get(c) ?? []), p]);
    }
    const cities = [...byCity.entries()]
      .map(([city, ps]) => ({ city, photos: ps }))
      .sort((a, b) =>
        a.city === OTHER_CITY ? 1 : b.city === OTHER_CITY ? -1 : b.photos.length - a.photos.length || a.city.localeCompare(b.city, 'tr'),
      );
    groups.push({
      country,
      countryCode: list.find((p) => p.countryCode)?.countryCode ?? null,
      count: list.length,
      cover: list[list.length - 1],
      cities,
    });
  }
  return groups.sort((a, b) =>
    a.country === UNKNOWN_COUNTRY ? 1 : b.country === UNKNOWN_COUNTRY ? -1
      : b.count - a.count || a.country.localeCompare(b.country, 'tr'));
}

/** "TR" → 🇹🇷 */
export function flag(code: string | null | undefined): string {
  if (!code || !/^[a-zA-Z]{2}$/.test(code)) return '🌍';
  return String.fromCodePoint(...code.toUpperCase().split('').map((c) => 0x1f1e6 + c.charCodeAt(0) - 65));
}
