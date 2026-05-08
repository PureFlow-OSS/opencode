CREATE TABLE IF NOT EXISTS `memory` (
	`id` text PRIMARY KEY,
	`scope` text NOT NULL,
	`category` text NOT NULL,
	`content` text NOT NULL,
	`previous` text,
	`source` text NOT NULL,
	`confidence` real DEFAULT 1.0,
	`created_at` integer NOT NULL,
	`last_used` integer,
	`use_count` integer DEFAULT 0,
	`ttl` integer,
	`time_created` integer NOT NULL,
	`time_updated` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `memory_scope_idx` ON `memory` (`scope`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `memory_category_idx` ON `memory` (`category`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `memory_scope_category_idx` ON `memory` (`scope`,`category`);
