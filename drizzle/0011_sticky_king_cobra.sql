PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_human_invites` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`token_hash` text NOT NULL,
	`invited_by_owner_id` integer NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`consumed_at` integer,
	`consumed_by_auth_user_id` text,
	`revoked_at` integer,
	FOREIGN KEY (`invited_by_owner_id`) REFERENCES `owners`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`consumed_by_auth_user_id`) REFERENCES `auth_users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_human_invites`("id", "token_hash", "invited_by_owner_id", "created_at", "expires_at", "consumed_at", "consumed_by_auth_user_id", "revoked_at") SELECT "id", "token_hash", "invited_by_owner_id", "created_at", "expires_at", "consumed_at", "consumed_by_auth_user_id", "revoked_at" FROM `human_invites`;--> statement-breakpoint
DROP TABLE `human_invites`;--> statement-breakpoint
ALTER TABLE `__new_human_invites` RENAME TO `human_invites`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `human_invites_token_hash_unique` ON `human_invites` (`token_hash`);--> statement-breakpoint
CREATE INDEX `human_invites_inviter_idx` ON `human_invites` (`invited_by_owner_id`);