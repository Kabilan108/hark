ALTER TABLE `device` ADD `fcm_token` text;--> statement-breakpoint
ALTER TABLE `device` ADD `notification_schema_version` integer;--> statement-breakpoint
ALTER TABLE `device` ADD `promoted_notifications_capable` integer;--> statement-breakpoint
CREATE UNIQUE INDEX `device_fcm_token_unique` ON `device` (`fcm_token`);