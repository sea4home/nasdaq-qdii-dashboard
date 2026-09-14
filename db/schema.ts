import { sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const dailyCache = sqliteTable('daily_cache', {
  cacheKey: text('cache_key').primaryKey(),
  cacheDay: text('cache_day').notNull(),
  payload: text('payload').notNull(),
  updatedAt: text('updated_at').notNull(),
});
