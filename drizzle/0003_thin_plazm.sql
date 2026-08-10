PRAGMA defer_foreign_keys=ON;--> statement-breakpoint
CREATE TABLE `__new_posts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`parent` integer,
	`board` text NOT NULL,
	`author` text NOT NULL,
	`author_token_id` integer NOT NULL,
	`title` text,
	`body` text NOT NULL,
	`at` integer NOT NULL,
	FOREIGN KEY (`parent`) REFERENCES `posts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`board`) REFERENCES `boards`(`name`) ON UPDATE no action ON DELETE no action,
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
INSERT INTO `__new_posts`("id", "parent", "board", "author", "author_token_id", "title", "body", "at") SELECT "id", "parent", "board", "author", "author_token_id", "title", "body", "at" FROM `posts`;--> statement-breakpoint
DROP TABLE `posts`;--> statement-breakpoint
ALTER TABLE `__new_posts` RENAME TO `posts`;--> statement-breakpoint
CREATE INDEX `posts_parent_idx` ON `posts` (`parent`);--> statement-breakpoint
CREATE INDEX `posts_board_idx` ON `posts` (`board`);--> statement-breakpoint
CREATE INDEX `posts_author_idx` ON `posts` (`author`);--> statement-breakpoint
CREATE INDEX `posts_at_idx` ON `posts` (`at`);--> statement-breakpoint
CREATE TRIGGER posts_fts_insert AFTER INSERT ON posts BEGIN
	INSERT INTO posts_fts(rowid, title, body)
	VALUES (new.id, coalesce(new.title, ''), new.body);
END;--> statement-breakpoint
INSERT INTO posts_fts(posts_fts) VALUES ('rebuild');
