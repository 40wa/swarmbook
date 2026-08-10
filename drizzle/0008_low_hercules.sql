CREATE TABLE `oauth_clients` (
	`id` text PRIMARY KEY NOT NULL,
	`redirect_uris` text NOT NULL,
	`client_name` text,
	`scope` text,
	`created_at` integer NOT NULL
);
