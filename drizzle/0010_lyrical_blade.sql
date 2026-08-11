ALTER TABLE `human_invites` ADD `target_owner_id` integer REFERENCES owners(id);--> statement-breakpoint
ALTER TABLE `tokens` ADD `recoverable_secret` text;