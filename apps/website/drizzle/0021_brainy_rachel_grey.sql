ALTER TABLE `interaction` ADD `project_id` text REFERENCES project(id) ON DELETE set null;--> statement-breakpoint
UPDATE `interaction` SET `project_id` = (SELECT `event`.`project_id` FROM `event` WHERE `event`.`id` = `interaction`.`event_id`) WHERE `event_id` IS NOT NULL;--> statement-breakpoint
CREATE INDEX `interaction_project_created_at_idx` ON `interaction` (`project_id`,`created_at`);--> statement-breakpoint
ALTER TABLE `live_activity` ADD `project_id` text REFERENCES project(id) ON DELETE set null;--> statement-breakpoint
UPDATE `live_activity` SET `project_id` = (SELECT `interaction`.`project_id` FROM `interaction` WHERE `interaction`.`id` = `live_activity`.`interaction_id`) WHERE `interaction_id` IS NOT NULL;--> statement-breakpoint
CREATE INDEX `live_activity_project_updated_idx` ON `live_activity` (`project_id`,`updated_at`);--> statement-breakpoint
ALTER TABLE `project` ADD `archived_at` integer;
