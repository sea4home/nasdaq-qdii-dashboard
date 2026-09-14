import { env } from 'cloudflare:workers';

export type CacheMetadata = {
  day: string;
  updatedAt: string;
  status: 'hit' | 'updated' | 'stale' | 'unavailable';
};

type CacheRow = {
  cache_day: string;
  payload: string;
  updated_at: string;
};

const pending = new Map<string, Promise<unknown>>();

export function chinaDay(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

function database() {
  return (env as unknown as { DB?: D1Database }).DB;
}

export async function readCache<T>(cacheKey: string, requiredDay?: string) {
  const db = database();
  if (!db) return null;
  try {
    const query = requiredDay
      ? 'SELECT cache_day, payload, updated_at FROM daily_cache WHERE cache_key = ? AND cache_day = ? LIMIT 1'
      : 'SELECT cache_day, payload, updated_at FROM daily_cache WHERE cache_key = ? LIMIT 1';
    const statement = db.prepare(query).bind(...(requiredDay ? [cacheKey, requiredDay] : [cacheKey]));
    const row = await statement.first<CacheRow>();
    if (!row) return null;
    return { value: JSON.parse(row.payload) as T, day: row.cache_day, updatedAt: row.updated_at };
  } catch (error) {
    console.error('Daily cache read failed', cacheKey, error);
    return null;
  }
}

export async function writeCache<T>(cacheKey: string, cacheDay: string, value: T) {
  const db = database();
  if (!db) return null;
  const updatedAt = new Date().toISOString();
  try {
    await db.prepare(`
      INSERT INTO daily_cache (cache_key, cache_day, payload, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(cache_key) DO UPDATE SET
        cache_day = excluded.cache_day,
        payload = excluded.payload,
        updated_at = excluded.updated_at
    `).bind(cacheKey, cacheDay, JSON.stringify(value), updatedAt).run();
    return { day: cacheDay, updatedAt };
  } catch (error) {
    console.error('Daily cache write failed', cacheKey, error);
    return null;
  }
}

export async function oncePerIsolate<T>(key: string, operation: () => Promise<T>) {
  const existing = pending.get(key) as Promise<T> | undefined;
  if (existing) return existing;
  const current = operation().finally(() => pending.delete(key));
  pending.set(key, current);
  return current;
}
