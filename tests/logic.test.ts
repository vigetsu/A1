import assert from 'node:assert/strict';
import { test } from 'node:test';

import { flag, gpsFromExif, groupPhotos, takenAtFromExif, UNKNOWN_COUNTRY, type Photo } from '../src/lib/logic.ts';

test('iOS {GPS} exif', () => {
  const c = gpsFromExif({ '{GPS}': { Latitude: 41.8902, LatitudeRef: 'N', Longitude: 12.4922, LongitudeRef: 'E' } });
  assert.deepEqual(c, { latitude: 41.8902, longitude: 12.4922 });
});

test('Android rasyonel exif + güney/batı', () => {
  const c = gpsFromExif({ GPSLatitude: '22/1,54/1,3000/100', GPSLatitudeRef: 'S', GPSLongitude: '43/1,12/1,0/1', GPSLongitudeRef: 'W' });
  assert.ok(c);
  assert.ok(Math.abs(c.latitude + 22.908333) < 1e-5);
  assert.ok(Math.abs(c.longitude + 43.2) < 1e-5);
});

test('Android ondalık exif', () => {
  assert.deepEqual(gpsFromExif({ GPSLatitude: 48.137, GPSLatitudeRef: 'N', GPSLongitude: 11.575, GPSLongitudeRef: 'E' }),
    { latitude: 48.137, longitude: 11.575 });
});

test('GPS yoksa / 0,0 ise null', () => {
  assert.equal(gpsFromExif(null), null);
  assert.equal(gpsFromExif({ Make: 'Apple' }), null);
  assert.equal(gpsFromExif({ GPSLatitude: 0, GPSLongitude: 0 }), null);
});

test('çekim tarihi', () => {
  assert.equal(takenAtFromExif({ '{Exif}': { DateTimeOriginal: '2024:07:15 18:30:05' } }), '2024-07-15T18:30:05');
  assert.equal(takenAtFromExif({ DateTime: 'bozuk' }), null);
});

const p = (id: number, country: string, city: string | null, code = 'IT'): Photo => ({
  id, key: String(id), uri: `file://${id}.jpg`, country, countryCode: code, city, landmark: null,
  description: null, latitude: null, longitude: null, takenAt: null, source: 'ai', confidence: 0.9,
  reasoning: null, addedAt: '2026-01-01',
});

test('Ülke → Şehir gruplama', () => {
  const g = groupPhotos([p(1, 'İtalya', 'Roma'), p(2, 'İtalya', null), p(3, 'Japonya', 'Kyoto', 'JP'),
    p(4, 'İtalya', 'Roma'), p(5, 'İtalya', 'Venedik')]);
  assert.deepEqual(g.map((x) => x.country), ['İtalya', 'Japonya']);
  assert.deepEqual(g[0].cities.map((c) => c.city), ['Roma', 'Venedik', 'Diğer']);
  assert.equal(g[0].count, 4);
});

test('Konumu bilinmeyen en sona', () => {
  const g = groupPhotos([p(1, UNKNOWN_COUNTRY, null), p(2, UNKNOWN_COUNTRY, null), p(3, 'Japonya', 'Kyoto', 'JP')]);
  assert.deepEqual(g.map((x) => x.country), ['Japonya', UNKNOWN_COUNTRY]);
});

test('bayrak', () => {
  assert.equal(flag('tr'), '🇹🇷');
  assert.equal(flag(null), '🌍');
});
