PRAGMA defer_foreign_keys=ON;--> statement-breakpoint
CREATE TABLE `__new_boards` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`description` text NOT NULL,
	`created_at` integer NOT NULL,
	`archived_at` integer,
	CONSTRAINT "boards_name_format" CHECK(length("name") between 1 and 32 and "name" not glob '*[^a-z0-9_-]*' and "name" not glob '-*')
);
--> statement-breakpoint
INSERT INTO `__new_boards` (`name`, `description`, `created_at`)
SELECT `name`, `description`, `created_at` FROM `boards` ORDER BY `name`;--> statement-breakpoint
DROP TABLE `boards`;--> statement-breakpoint
ALTER TABLE `__new_boards` RENAME TO `boards`;--> statement-breakpoint
CREATE UNIQUE INDEX `boards_name_active_unique` ON `boards` (lower("name")) WHERE `archived_at` IS NULL;--> statement-breakpoint
CREATE INDEX `boards_archived_idx` ON `boards` (`archived_at`);--> statement-breakpoint
CREATE TABLE `__new_posts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`parent` integer,
	`board_id` integer NOT NULL,
	`board` text NOT NULL,
	`owner` text NOT NULL,
	`author` text NOT NULL,
	`author_token_id` integer NOT NULL,
	`title` text,
	`body` text NOT NULL,
	`at` integer NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`parent`) REFERENCES `posts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`board_id`) REFERENCES `boards`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`author_token_id`) REFERENCES `tokens`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "posts_shape" CHECK((
        ("parent" is null and "title" is not null)
        or
        ("parent" is not null and "title" is null)
      )),
	CONSTRAINT "posts_title_length" CHECK("title" is null or length("title") between 1 and 200),
	CONSTRAINT "posts_body_length" CHECK(length("body") between 1 and 1000)
);
--> statement-breakpoint
INSERT INTO `__new_posts` (`id`, `parent`, `board_id`, `board`, `owner`, `author`, `author_token_id`, `title`, `body`, `at`)
SELECT p.`id`, p.`parent`, b.`id`, p.`board`, p.`owner`, p.`author`, p.`author_token_id`, p.`title`, p.`body`, p.`at`
FROM `posts` p JOIN `boards` b ON b.`name` = p.`board`;--> statement-breakpoint
DROP TABLE `posts`;--> statement-breakpoint
ALTER TABLE `__new_posts` RENAME TO `posts`;--> statement-breakpoint
CREATE INDEX `posts_parent_idx` ON `posts` (`parent`);--> statement-breakpoint
CREATE INDEX `posts_board_idx` ON `posts` (`board`);--> statement-breakpoint
CREATE INDEX `posts_board_id_idx` ON `posts` (`board_id`);--> statement-breakpoint
CREATE INDEX `posts_author_idx` ON `posts` (`author`);--> statement-breakpoint
CREATE INDEX `posts_at_idx` ON `posts` (`at`);--> statement-breakpoint
CREATE INDEX `posts_deleted_at_idx` ON `posts` (`deleted_at`);--> statement-breakpoint
CREATE TRIGGER posts_fts_insert AFTER INSERT ON posts BEGIN
	INSERT INTO posts_fts(rowid, title, body)
	VALUES (new.id, coalesce(new.title, ''), new.body);
END;--> statement-breakpoint
INSERT INTO posts_fts(posts_fts) VALUES ('rebuild');
