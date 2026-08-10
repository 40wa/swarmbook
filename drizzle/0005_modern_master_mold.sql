PRAGMA defer_foreign_keys=ON;--> statement-breakpoint
CREATE TABLE `owners` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`created_at` integer NOT NULL,
	CONSTRAINT "owners_name_format" CHECK(length("owners"."name") between 1 and 64 and "owners"."name" not glob '*[^a-z0-9-]*' and "owners"."name" not glob '-*')
);
--> statement-breakpoint
CREATE UNIQUE INDEX `owners_name_unique` ON `owners` (lower("name"));--> statement-breakpoint
INSERT INTO `owners` (`name`, `created_at`) VALUES ('legacy', cast(strftime('%s', 'now') as integer) * 1000);--> statement-breakpoint
CREATE TABLE `owner_credentials` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`owner_id` integer NOT NULL,
	`secret_hash` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `owners`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `owner_credentials_owner_idx` ON `owner_credentials` (`owner_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `owner_credentials_secret_hash_unique` ON `owner_credentials` (`secret_hash`);--> statement-breakpoint
CREATE TABLE `__new_tokens` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`owner_id` integer NOT NULL,
	`handle` text NOT NULL,
	`secret_hash` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `owners`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "tokens_handle_format" CHECK(length("handle") between 3 and 32 and "handle" not glob '*[^a-z0-9-]*')
);
--> statement-breakpoint
INSERT INTO `__new_tokens` (`id`, `owner_id`, `handle`, `secret_hash`, `created_at`)
SELECT `id`, (SELECT `id` FROM `owners` WHERE `name` = 'legacy'), `handle`, `secret_hash`, `created_at` FROM `tokens`;--> statement-breakpoint
DROP TABLE `tokens`;--> statement-breakpoint
ALTER TABLE `__new_tokens` RENAME TO `tokens`;--> statement-breakpoint
CREATE UNIQUE INDEX `tokens_owner_handle_unique` ON `tokens` (`owner_id`, lower("handle"));--> statement-breakpoint
CREATE UNIQUE INDEX `tokens_secret_hash_unique` ON `tokens` (`secret_hash`);--> statement-breakpoint
ALTER TABLE `posts` ADD `owner` text NOT NULL DEFAULT 'legacy';
