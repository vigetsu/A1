// Fotoğraf kayıtları için yerel SQLite veritabanı.
import * as SQLite from 'expo-sqlite';
import type { Photo, Source } from './logic';

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

function db() {
  if (!dbPromise) {
    dbPromise = (async () => {
      const d = await SQLite.openDatabaseAsync('gezi-albumu.db');
      await d.execAsync(`
        PRAGMA journal_mode = WAL;
        CREATE TABLE IF NOT EXISTS photos (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          key TEXT UNIQUE NOT NULL,
          uri TEXT NOT NULL,
          country TEXT NOT NULL,
          country_code TEXT,
          city TEXT,
          landmark TEXT,
          description TEXT,
          latitude REAL,
          longitude REAL,
          taken_at TEXT,
          source TEXT NOT NULL,
          confidence REAL,
          reasoning TEXT,
          added_at TEXT NOT NULL
        );`);
      return d;
    })();
  }
  return dbPromise;
}

interface Row {
  id: number; key: string; uri: string; country: string; country_code: string | null;
  city: string | null; landmark: string | null; description: string | null;
  latitude: number | null; longitude: number | null; taken_at: string | null;
  source: Source; confidence: number | null; reasoning: string | null; added_at: string;
}

const toPhoto = (r: Row): Photo => ({
  id: r.id, key: r.key, uri: r.uri, country: r.country, countryCode: r.country_code,
  city: r.city, landmark: r.landmark, description: r.description,
  latitude: r.latitude, longitude: r.longitude, takenAt: r.taken_at, source: r.source,
  confidence: r.confidence, reasoning: r.reasoning, addedAt: r.added_at,
});

export async function allPhotos(): Promise<Photo[]> {
  const rows = await (await db()).getAllAsync<Row>(
    'SELECT * FROM photos ORDER BY COALESCE(taken_at, added_at)',
  );
  return rows.map(toPhoto);
}

export async function exists(key: string): Promise<boolean> {
  return (await (await db()).getFirstAsync('SELECT 1 FROM photos WHERE key = ?', key)) != null;
}

export type NewPhoto = Omit<Photo, 'id' | 'addedAt'>;

export async function insertPhoto(p: NewPhoto): Promise<number> {
  const res = await (await db()).runAsync(
    `INSERT INTO photos (key, uri, country, country_code, city, landmark, description, latitude,
       longitude, taken_at, source, confidence, reasoning, added_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    p.key, p.uri, p.country.trim(), p.countryCode, p.city?.trim() || null, p.landmark,
    p.description, p.latitude, p.longitude, p.takenAt, p.source, p.confidence, p.reasoning,
    new Date().toISOString(),
  );
  return res.lastInsertRowId;
}

export async function updateLocation(id: number, country: string, city: string | null) {
  await (await db()).runAsync(
    "UPDATE photos SET country = ?, city = ?, source = 'manuel' WHERE id = ?",
    country.trim(), city?.trim() || null, id,
  );
}

export async function deletePhoto(id: number) {
  await (await db()).runAsync('DELETE FROM photos WHERE id = ?', id);
}
