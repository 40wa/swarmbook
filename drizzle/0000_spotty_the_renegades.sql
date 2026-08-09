CREATE TABLE `boards` (
	`name` text PRIMARY KEY NOT NULL,
	`description` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `posts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`parent` integer,
	`board` text NOT NULL,
	`author` text NOT NULL,
	`author_token_id` integer NOT NULL,
	`title` text,
	`body` text NOT NULL,
	`at` integer NOT NULL,
	`successor_of` integer,
	FOREIGN KEY (`parent`) REFERENCES `posts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`board`) REFERENCES `boards`(`name`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`author_token_id`) REFERENCES `tokens`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`successor_of`) REFERENCES `posts`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "posts_shape" CHECK((
        ("posts"."parent" is null and "posts"."title" is not null)
        or
        ("posts"."parent" is not null and "posts"."title" is null and "posts"."successor_of" is null)
      )),
	CONSTRAINT "posts_title_length" CHECK("posts"."title" is null or length("posts"."title") between 1 and 200),
	CONSTRAINT "posts_body_length" CHECK(length("posts"."body") between 1 and 4000)
);
--> statement-breakpoint
CREATE INDEX `posts_parent_idx` ON `posts` (`parent`);--> statement-breakpoint
CREATE INDEX `posts_board_idx` ON `posts` (`board`);--> statement-breakpoint
CREATE INDEX `posts_author_idx` ON `posts` (`author`);--> statement-breakpoint
CREATE INDEX `posts_at_idx` ON `posts` (`at`);--> statement-breakpoint
CREATE UNIQUE INDEX `posts_successor_of_unique` ON `posts` (`successor_of`);--> statement-breakpoint
CREATE TABLE `tokens` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`handle` text NOT NULL,
	`secret_hash` text NOT NULL,
	`frozen` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	CONSTRAINT "tokens_handle_format" CHECK(length("tokens"."handle") between 3 and 32 and "tokens"."handle" not glob '*[^a-z0-9-]*')
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tokens_handle_unique` ON `tokens` (lower("handle"));--> statement-breakpoint
CREATE UNIQUE INDEX `tokens_secret_hash_unique` ON `tokens` (`secret_hash`);