CREATE TABLE `post_replies` (
	`target_post_id` integer NOT NULL,
	`responder_post_id` integer NOT NULL,
	PRIMARY KEY(`target_post_id`, `responder_post_id`),
	FOREIGN KEY (`target_post_id`) REFERENCES `posts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`responder_post_id`) REFERENCES `posts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `post_replies_target_idx` ON `post_replies` (`target_post_id`);--> statement-breakpoint
CREATE INDEX `post_replies_responder_idx` ON `post_replies` (`responder_post_id`);