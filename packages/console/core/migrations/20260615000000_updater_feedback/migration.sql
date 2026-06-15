CREATE TABLE `updater_release` (
  `id` varchar(30) NOT NULL,
  `time_created` timestamp(3) NOT NULL DEFAULT (now()),
  `time_updated` timestamp(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)),
  `time_deleted` timestamp(3) DEFAULT NULL,
  `channel` enum('beta','normal') NOT NULL,
  `version` varchar(64) NOT NULL,
  `zip_name` varchar(255) NOT NULL,
  `zip_sha256` varchar(64) NOT NULL,
  `zip_size` int NOT NULL,
  `notes` mediumtext,
  `promoted_from_release_id` varchar(30),
  `time_promoted` timestamp(3),
  PRIMARY KEY (`id`),
  KEY `updater_release_channel_idx` (`channel`, `time_created`)
);

CREATE TABLE `updater_feedback` (
  `id` varchar(30) NOT NULL,
  `time_created` timestamp(3) NOT NULL DEFAULT (now()),
  `time_updated` timestamp(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)),
  `time_deleted` timestamp(3) DEFAULT NULL,
  `channel` enum('beta','general') NOT NULL,
  `release_id` varchar(30),
  `user_name` varchar(255),
  `user_email` varchar(255),
  `rating` enum('positive','neutral','negative') NOT NULL,
  `message` mediumtext NOT NULL,
  PRIMARY KEY (`id`),
  KEY `updater_feedback_channel_idx` (`channel`, `time_created`)
);

CREATE TABLE `updater_audit` (
  `id` varchar(30) NOT NULL,
  `time_created` timestamp(3) NOT NULL DEFAULT (now()),
  `time_updated` timestamp(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)),
  `time_deleted` timestamp(3) DEFAULT NULL,
  `feedback_id` varchar(30) NOT NULL,
  `actor` varchar(255) NOT NULL,
  `action` varchar(64) NOT NULL,
  `details` mediumtext NOT NULL,
  PRIMARY KEY (`id`),
  KEY `updater_audit_feedback_idx` (`feedback_id`, `time_created`)
);
