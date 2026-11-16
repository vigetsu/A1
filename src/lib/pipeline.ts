// Seçilen bir fotoğrafı işleyip konumunu bulan ve albüme kaydeden ana akış.
import { Directory, File, Paths } from 'expo-file-system';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import type { ImagePickerAsset } from 'expo-image-picker';
import * as Location from 'expo-location';

import { AIUnavailable, detectLocation, type LocationGuess } from './ai';
import * as db from './db';
import { gpsFromExif, takenAtFromExif, type Coords, type Photo } from './logic';

export type ProcessStatus = 'eklendi' | 'zaten_var' | 'hata';
export interface ProcessResult { name: string; status: ProcessStatus; message: string }

export interface ProcessOptions { useGps: boolean; aiForGps: boolean }

const MAX_SIDE = 1568;

function photosDir(): Directory {
  const dir = new Directory(Paths.document, 'photos');
  if (!dir.exists) dir.create({ intermediates: true });
  return dir;
}

function assetKey(a: ImagePickerAsset): string {
  return a.assetId || `${a.fileName ?? ''}|${a.fileSize ?? ''}|${a.width}x${a.height}`;
}

interface Place { country: string; city: string | null; countryCode: string | null }

async function reverseGeocode(c: Coords): Promise<Place | null> {
  try {
    const perm = await Location.getForegroundPermissionsAsync();
    if (!perm.granted && perm.canAskAgain) await Location.requestForegroundPermissionsAsync();
    const [addr] = await Location.reverseGeocodeAsync(c);
    if (!addr?.country) return null;
    return {
      country: addr.country,
      city: addr.city || addr.subregion || addr.region || null,
      countryCode: addr.isoCountryCode?.toUpperCase() ?? null,
    };
  } catch {
    return null; // izin yok / internet yok → yapay zekâya bırak
  }
}

/** Küçültülmüş JPEG'i uygulama klasörüne kaydeder; kalıcı uri + base64 döner. */
async function saveResized(a: ImagePickerAsset): Promise<{ uri: string; base64: string }> {
  const ctx = ImageManipulator.manipulate(a.uri);
  if (Math.max(a.width, a.height) > MAX_SIDE) {
    ctx.resize(a.width >= a.height ? { width: MAX_SIDE } : { height: MAX_SIDE });
  }
  const img = await ctx.renderAsync();
  const out = await img.saveAsync({ format: SaveFormat.JPEG, compress: 0.85, base64: true });
  const dest = new File(photosDir(), `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`);
  await new File(out.uri).move(dest);
  return { uri: dest.uri, base64: out.base64 ?? (await dest.base64()) };
}

export async function processAsset(a: ImagePickerAsset, opts: ProcessOptions): Promise<ProcessResult> {
  const name = a.fileName ?? 'Fotoğraf';
  const key = assetKey(a);
  if (await db.exists(key)) return { name, status: 'zaten_var', message: 'Zaten albümde.' };

  const coords = gpsFromExif(a.exif);
  const takenAt = takenAtFromExif(a.exif);

  let saved: { uri: string; base64: string };
  try {
    saved = await saveResized(a);
  } catch {
    return { name, status: 'hata', message: 'Fotoğraf açılamadı.' };
  }

  // 1) GPS varsa telefonun kendi haritasıyla kesin konum
  const place = opts.useGps && coords ? await reverseGeocode(coords) : null;

  // 2) Yapay zekâ: GPS yoksa konumu bulur, varsa simge/açıklama ekler
  let guess: LocationGuess | null = null;
  if (!place || opts.aiForGps) {
    try {
      const hint = place ? `GPS verisine göre fotoğraf ${place.city ?? ''} ${place.country} konumunda çekildi.` : undefined;
      guess = await detectLocation(saved.base64, hint);
    } catch (err) {
      if (!place) {
        new File(saved.uri).delete();
        const msg = err instanceof AIUnavailable ? err.message : 'Beklenmeyen hata.';
        return { name, status: 'hata', message: `Konum bulunamadı: ${msg}` };
      }
    }
  }

  const base: Omit<Photo, 'id' | 'addedAt' | 'country' | 'countryCode' | 'city' | 'source' | 'confidence' | 'reasoning'> = {
    key, uri: saved.uri, latitude: coords?.latitude ?? null, longitude: coords?.longitude ?? null,
    takenAt, landmark: guess?.landmark ?? null, description: guess?.description ?? null,
  };

  if (place) {
    await db.insertPhoto({
      ...base, country: place.country, countryCode: place.countryCode, city: place.city,
      source: 'gps', confidence: 1, reasoning: 'Fotoğrafın GPS koordinatlarından bulundu.',
    });
    return { name, status: 'eklendi', message: `📍 ${[place.city, place.country].filter(Boolean).join(', ')}` };
  }

  const g = guess!;
  await db.insertPhoto({
    ...base, country: g.country, countryCode: g.country_code, city: g.city,
    source: 'ai', confidence: g.confidence, reasoning: g.reasoning,
  });
  return {
    name, status: 'eklendi',
    message: `🤖 ${[g.city, g.country].filter(Boolean).join(', ')} (%${Math.round(g.confidence * 100)})`,
  };
}

export function removePhotoFile(uri: string) {
  try {
    const f = new File(uri);
    if (f.exists) f.delete();
  } catch {
    /* dosya zaten yok */
  }
}
