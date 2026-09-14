CREATE TABLE `daily_cache` (
	`cache_key` text PRIMARY KEY NOT NULL,
	`cache_day` text NOT NULL,
	`payload` text NOT NULL,
	`updated_at` text NOT NULL
);
