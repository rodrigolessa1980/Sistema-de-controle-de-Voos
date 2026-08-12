-- CreateTable
CREATE TABLE `users` (
    `id` VARCHAR(191) NOT NULL,
    `email` VARCHAR(190) NOT NULL,
    `password_hash` VARCHAR(255) NOT NULL,
    `name` VARCHAR(180) NOT NULL,
    `status` ENUM('ativo', 'inativo', 'bloqueado') NOT NULL DEFAULT 'ativo',
    `role_id` VARCHAR(191) NOT NULL,
    `client_id` VARCHAR(191) NULL,
    `must_change_password` BOOLEAN NOT NULL DEFAULT false,
    `last_login_at` DATETIME(3) NULL,
    `failed_login_count` INTEGER NOT NULL DEFAULT 0,
    `locked_until` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `deleted_at` DATETIME(3) NULL,

    UNIQUE INDEX `users_email_key`(`email`),
    INDEX `users_role_id_idx`(`role_id`),
    INDEX `users_client_id_idx`(`client_id`),
    INDEX `users_status_deleted_at_idx`(`status`, `deleted_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `roles` (
    `id` VARCHAR(191) NOT NULL,
    `key` VARCHAR(48) NOT NULL,
    `name` VARCHAR(120) NOT NULL,
    `description` VARCHAR(255) NULL,
    `is_system` BOOLEAN NOT NULL DEFAULT false,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `roles_key_key`(`key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `permissions` (
    `id` VARCHAR(191) NOT NULL,
    `key` VARCHAR(96) NOT NULL,
    `resource` VARCHAR(48) NOT NULL,
    `action` VARCHAR(48) NOT NULL,
    `description` VARCHAR(255) NULL,

    UNIQUE INDEX `permissions_key_key`(`key`),
    INDEX `permissions_resource_idx`(`resource`),
    UNIQUE INDEX `permissions_resource_action_key`(`resource`, `action`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `role_permissions` (
    `role_id` VARCHAR(191) NOT NULL,
    `permission_id` VARCHAR(191) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `role_permissions_permission_id_idx`(`permission_id`),
    PRIMARY KEY (`role_id`, `permission_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `user_permissions` (
    `user_id` VARCHAR(191) NOT NULL,
    `permission_id` VARCHAR(191) NOT NULL,
    `effect` ENUM('allow', 'deny') NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `user_permissions_permission_id_idx`(`permission_id`),
    PRIMARY KEY (`user_id`, `permission_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `refresh_tokens` (
    `id` VARCHAR(191) NOT NULL,
    `user_id` VARCHAR(191) NOT NULL,
    `token_hash` VARCHAR(64) NOT NULL,
    `expires_at` DATETIME(3) NOT NULL,
    `revoked_at` DATETIME(3) NULL,
    `ip` VARCHAR(64) NULL,
    `user_agent` VARCHAR(255) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `refresh_tokens_token_hash_key`(`token_hash`),
    INDEX `refresh_tokens_user_id_revoked_at_idx`(`user_id`, `revoked_at`),
    INDEX `refresh_tokens_expires_at_idx`(`expires_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `clients` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(180) NOT NULL,
    `company` VARCHAR(180) NULL,
    `document` VARCHAR(20) NULL,
    `email` VARCHAR(190) NOT NULL,
    `phone` VARCHAR(32) NULL,
    `notes` TEXT NULL,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `open_balance` DECIMAL(14, 2) NOT NULL DEFAULT 0,
    `overdue_balance` DECIMAL(14, 2) NOT NULL DEFAULT 0,
    `total_invoiced` DECIMAL(14, 2) NOT NULL DEFAULT 0,
    `total_paid` DECIMAL(14, 2) NOT NULL DEFAULT 0,
    `financial_status` ENUM('em_dia', 'pendente', 'vencido') NOT NULL DEFAULT 'em_dia',
    `trip_count` INTEGER NOT NULL DEFAULT 0,
    `aggregates_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `deleted_at` DATETIME(3) NULL,

    UNIQUE INDEX `clients_document_key`(`document`),
    UNIQUE INDEX `clients_email_key`(`email`),
    INDEX `clients_financial_status_idx`(`financial_status`),
    INDEX `clients_name_idx`(`name`),
    INDEX `clients_active_deleted_at_idx`(`active`, `deleted_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `aircraft` (
    `id` VARCHAR(191) NOT NULL,
    `prefix` VARCHAR(12) NOT NULL,
    `kind` ENUM('aviao', 'helicoptero') NOT NULL,
    `model` VARCHAR(120) NOT NULL,
    `manufacturer` VARCHAR(120) NOT NULL,
    `capacity` INTEGER NOT NULL,
    `cruise_speed` INTEGER NOT NULL DEFAULT 0,
    `status` ENUM('disponivel', 'em_voo', 'manutencao', 'indisponivel') NOT NULL DEFAULT 'disponivel',
    `notes` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `deleted_at` DATETIME(3) NULL,

    UNIQUE INDEX `aircraft_prefix_key`(`prefix`),
    INDEX `aircraft_status_deleted_at_idx`(`status`, `deleted_at`),
    INDEX `aircraft_kind_idx`(`kind`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `tariffs` (
    `id` VARCHAR(191) NOT NULL,
    `aircraft_id` VARCHAR(191) NOT NULL,
    `value` DECIMAL(14, 2) NOT NULL,
    `cost_fuel` DECIMAL(14, 2) NOT NULL DEFAULT 0,
    `cost_flight_hour` DECIMAL(14, 2) NOT NULL DEFAULT 0,
    `cost_fees` DECIMAL(14, 2) NOT NULL DEFAULT 0,
    `cost_pilot` DECIMAL(14, 2) NOT NULL DEFAULT 0,
    `unit` ENUM('por_hora', 'por_trecho', 'diaria') NOT NULL DEFAULT 'por_hora',
    `start_date` DATE NOT NULL,
    `end_date` DATE NULL,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `tariffs_aircraft_id_active_start_date_idx`(`aircraft_id`, `active`, `start_date`),
    INDEX `tariffs_active_idx`(`active`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `document_files` (
    `id` VARCHAR(191) NOT NULL,
    `storage_key` VARCHAR(255) NOT NULL,
    `original_name` VARCHAR(255) NOT NULL,
    `mime_type` VARCHAR(96) NOT NULL,
    `size_bytes` INTEGER NOT NULL,
    `checksum` VARCHAR(64) NULL,
    `width` INTEGER NULL,
    `height` INTEGER NULL,
    `uploaded_by_id` VARCHAR(191) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `purge_after` DATETIME(3) NULL,
    `deleted_at` DATETIME(3) NULL,

    UNIQUE INDEX `document_files_storage_key_key`(`storage_key`),
    INDEX `document_files_checksum_idx`(`checksum`),
    INDEX `document_files_purge_after_deleted_at_idx`(`purge_after`, `deleted_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `passengers` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(180) NOT NULL,
    `trip_id` VARCHAR(191) NULL,
    `request_id` VARCHAR(191) NULL,
    `document_file_id` VARCHAR(191) NULL,
    `position` INTEGER NOT NULL DEFAULT 0,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `passengers_trip_id_idx`(`trip_id`),
    INDEX `passengers_request_id_idx`(`request_id`),
    INDEX `passengers_document_file_id_idx`(`document_file_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `flight_requests` (
    `id` VARCHAR(191) NOT NULL,
    `code` VARCHAR(24) NOT NULL,
    `client_id` VARCHAR(191) NOT NULL,
    `origin` VARCHAR(160) NOT NULL,
    `destination` VARCHAR(160) NOT NULL,
    `departure_at` DATETIME(3) NOT NULL,
    `return_at` DATETIME(3) NOT NULL,
    `passengers` INTEGER NOT NULL,
    `notes` TEXT NULL,
    `status` ENUM('aguardando_analise', 'em_analise', 'convertida', 'recusada') NOT NULL DEFAULT 'aguardando_analise',
    `trip_id` VARCHAR(191) NULL,
    `reviewed_by_id` VARCHAR(191) NULL,
    `reviewed_at` DATETIME(3) NULL,
    `rejection_reason` VARCHAR(500) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `flight_requests_code_key`(`code`),
    UNIQUE INDEX `flight_requests_trip_id_key`(`trip_id`),
    INDEX `flight_requests_client_id_status_idx`(`client_id`, `status`),
    INDEX `flight_requests_status_departure_at_idx`(`status`, `departure_at`),
    INDEX `flight_requests_departure_at_idx`(`departure_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `trips` (
    `id` VARCHAR(191) NOT NULL,
    `code` VARCHAR(24) NOT NULL,
    `client_id` VARCHAR(191) NOT NULL,
    `aircraft_id` VARCHAR(191) NULL,
    `origin` VARCHAR(160) NOT NULL,
    `destination` VARCHAR(160) NOT NULL,
    `departure_at` DATETIME(3) NOT NULL,
    `return_at` DATETIME(3) NOT NULL,
    `distance_km` DECIMAL(10, 2) NULL,
    `passengers` INTEGER NOT NULL DEFAULT 1,
    `notes` TEXT NULL,
    `status` ENUM('confirmada', 'recusada', 'em_andamento', 'concluida', 'cancelada') NOT NULL DEFAULT 'confirmada',
    `tariff_id` VARCHAR(191) NULL,
    `internal_tariff` DECIMAL(14, 2) NULL,
    `flight_hours` DECIMAL(8, 2) NULL,
    `estimated_value` DECIMAL(14, 2) NULL,
    `commercial_value` DECIMAL(14, 2) NULL,
    `created_by_id` VARCHAR(191) NULL,
    `canceled_by_id` VARCHAR(191) NULL,
    `canceled_at` DATETIME(3) NULL,
    `cancel_reason` VARCHAR(500) NULL,
    `completed_at` DATETIME(3) NULL,
    `scheduled_with_debt` BOOLEAN NOT NULL DEFAULT false,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `trips_code_key`(`code`),
    INDEX `trips_aircraft_id_departure_at_return_at_idx`(`aircraft_id`, `departure_at`, `return_at`),
    INDEX `trips_client_id_departure_at_idx`(`client_id`, `departure_at`),
    INDEX `trips_status_departure_at_idx`(`status`, `departure_at`),
    INDEX `trips_departure_at_idx`(`departure_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `aircraft_blocks` (
    `id` VARCHAR(191) NOT NULL,
    `aircraft_id` VARCHAR(191) NOT NULL,
    `kind` ENUM('manutencao', 'bloqueio') NOT NULL,
    `reason` VARCHAR(255) NOT NULL,
    `start_at` DATETIME(3) NOT NULL,
    `end_at` DATETIME(3) NOT NULL,
    `created_by_id` VARCHAR(191) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `aircraft_blocks_aircraft_id_start_at_end_at_idx`(`aircraft_id`, `start_at`, `end_at`),
    INDEX `aircraft_blocks_start_at_idx`(`start_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `charges` (
    `id` VARCHAR(191) NOT NULL,
    `code` VARCHAR(24) NOT NULL,
    `client_id` VARCHAR(191) NOT NULL,
    `trip_id` VARCHAR(191) NULL,
    `total` DECIMAL(14, 2) NOT NULL,
    `due_date` DATE NOT NULL,
    `description` VARCHAR(255) NULL,
    `paid_amount` DECIMAL(14, 2) NOT NULL DEFAULT 0,
    `balance` DECIMAL(14, 2) NOT NULL DEFAULT 0,
    `status` ENUM('pendente', 'parcial', 'pago', 'vencido') NOT NULL DEFAULT 'pendente',
    `settled_at` DATETIME(3) NULL,
    `created_by_id` VARCHAR(191) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `canceled_at` DATETIME(3) NULL,

    UNIQUE INDEX `charges_code_key`(`code`),
    INDEX `charges_client_id_status_idx`(`client_id`, `status`),
    INDEX `charges_status_due_date_idx`(`status`, `due_date`),
    INDEX `charges_due_date_idx`(`due_date`),
    INDEX `charges_trip_id_idx`(`trip_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `payments` (
    `id` VARCHAR(191) NOT NULL,
    `charge_id` VARCHAR(191) NOT NULL,
    `amount` DECIMAL(14, 2) NOT NULL,
    `paid_at` DATE NOT NULL,
    `method` ENUM('pix', 'transferencia', 'boleto', 'cartao', 'dinheiro') NOT NULL,
    `note` VARCHAR(500) NULL,
    `is_settlement` BOOLEAN NOT NULL DEFAULT false,
    `created_by_id` VARCHAR(191) NULL,
    `reversed_at` DATETIME(3) NULL,
    `reversed_by_id` VARCHAR(191) NULL,
    `reversal_reason` VARCHAR(500) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `payments_charge_id_reversed_at_idx`(`charge_id`, `reversed_at`),
    INDEX `payments_paid_at_idx`(`paid_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `settings` (
    `id` VARCHAR(191) NOT NULL DEFAULT 'singleton',
    `company_name` VARCHAR(180) NOT NULL,
    `contact_email` VARCHAR(190) NOT NULL,
    `timezone` VARCHAR(64) NOT NULL DEFAULT 'America/Sao_Paulo',
    `margin_minutes` INTEGER NOT NULL DEFAULT 45,
    `due_soon_days` INTEGER NOT NULL DEFAULT 15,
    `document_retention_days` INTEGER NOT NULL DEFAULT 365,
    `notify_on_new_request` BOOLEAN NOT NULL DEFAULT true,
    `notify_extra_emails` VARCHAR(500) NULL,
    `updated_by_id` VARCHAR(191) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `code_sequences` (
    `key` VARCHAR(32) NOT NULL,
    `prefix` VARCHAR(12) NOT NULL,
    `current` INTEGER NOT NULL,
    `padding` INTEGER NOT NULL DEFAULT 4,
    `updated_at` DATETIME(3) NOT NULL,

    PRIMARY KEY (`key`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `change_feed` (
    `seq` BIGINT NOT NULL AUTO_INCREMENT,
    `entity` VARCHAR(48) NOT NULL,
    `entity_id` VARCHAR(32) NOT NULL,
    `action` ENUM('created', 'updated', 'deleted') NOT NULL,
    `client_scope_id` VARCHAR(32) NULL,
    `actor_id` VARCHAR(32) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `change_feed_entity_seq_idx`(`entity`, `seq`),
    INDEX `change_feed_client_scope_id_seq_idx`(`client_scope_id`, `seq`),
    INDEX `change_feed_created_at_idx`(`created_at`),
    PRIMARY KEY (`seq`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `notifications` (
    `id` VARCHAR(191) NOT NULL,
    `user_id` VARCHAR(191) NOT NULL,
    `type` ENUM('solicitacao_nova', 'solicitacao_convertida', 'solicitacao_recusada', 'viagem_agendada', 'viagem_alterada', 'viagem_cancelada', 'cobranca_criada', 'cobranca_vencida', 'pagamento_recebido') NOT NULL,
    `title` VARCHAR(180) NOT NULL,
    `body` VARCHAR(500) NULL,
    `entity` VARCHAR(48) NULL,
    `entity_id` VARCHAR(32) NULL,
    `read_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `notifications_user_id_read_at_created_at_idx`(`user_id`, `read_at`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `email_outbox` (
    `id` VARCHAR(191) NOT NULL,
    `dedupe_key` VARCHAR(190) NOT NULL,
    `recipients` VARCHAR(1000) NOT NULL,
    `subject` VARCHAR(255) NOT NULL,
    `template` VARCHAR(64) NOT NULL,
    `payload` JSON NOT NULL,
    `reply_to` VARCHAR(190) NULL,
    `status` ENUM('pendente', 'enviando', 'enviado', 'falhou') NOT NULL DEFAULT 'pendente',
    `attempts` INTEGER NOT NULL DEFAULT 0,
    `max_attempts` INTEGER NOT NULL DEFAULT 5,
    `next_attempt_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `last_error` TEXT NULL,
    `sent_at` DATETIME(3) NULL,
    `provider_message_id` VARCHAR(190) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `email_outbox_dedupe_key_key`(`dedupe_key`),
    INDEX `email_outbox_status_next_attempt_at_idx`(`status`, `next_attempt_at`),
    INDEX `email_outbox_created_at_idx`(`created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `audit_logs` (
    `id` VARCHAR(191) NOT NULL,
    `user_id` VARCHAR(191) NULL,
    `action` VARCHAR(96) NOT NULL,
    `entity` VARCHAR(48) NOT NULL,
    `entity_id` VARCHAR(32) NULL,
    `before` JSON NULL,
    `after` JSON NULL,
    `ip` VARCHAR(64) NULL,
    `user_agent` VARCHAR(255) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `audit_logs_entity_entity_id_created_at_idx`(`entity`, `entity_id`, `created_at`),
    INDEX `audit_logs_user_id_created_at_idx`(`user_id`, `created_at`),
    INDEX `audit_logs_created_at_idx`(`created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `users` ADD CONSTRAINT `users_role_id_fkey` FOREIGN KEY (`role_id`) REFERENCES `roles`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `users` ADD CONSTRAINT `users_client_id_fkey` FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `role_permissions` ADD CONSTRAINT `role_permissions_role_id_fkey` FOREIGN KEY (`role_id`) REFERENCES `roles`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `role_permissions` ADD CONSTRAINT `role_permissions_permission_id_fkey` FOREIGN KEY (`permission_id`) REFERENCES `permissions`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `user_permissions` ADD CONSTRAINT `user_permissions_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `user_permissions` ADD CONSTRAINT `user_permissions_permission_id_fkey` FOREIGN KEY (`permission_id`) REFERENCES `permissions`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `refresh_tokens` ADD CONSTRAINT `refresh_tokens_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `tariffs` ADD CONSTRAINT `tariffs_aircraft_id_fkey` FOREIGN KEY (`aircraft_id`) REFERENCES `aircraft`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `document_files` ADD CONSTRAINT `document_files_uploaded_by_id_fkey` FOREIGN KEY (`uploaded_by_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `passengers` ADD CONSTRAINT `passengers_trip_id_fkey` FOREIGN KEY (`trip_id`) REFERENCES `trips`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `passengers` ADD CONSTRAINT `passengers_request_id_fkey` FOREIGN KEY (`request_id`) REFERENCES `flight_requests`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `passengers` ADD CONSTRAINT `passengers_document_file_id_fkey` FOREIGN KEY (`document_file_id`) REFERENCES `document_files`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `flight_requests` ADD CONSTRAINT `flight_requests_client_id_fkey` FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `flight_requests` ADD CONSTRAINT `flight_requests_trip_id_fkey` FOREIGN KEY (`trip_id`) REFERENCES `trips`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `flight_requests` ADD CONSTRAINT `flight_requests_reviewed_by_id_fkey` FOREIGN KEY (`reviewed_by_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `trips` ADD CONSTRAINT `trips_client_id_fkey` FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `trips` ADD CONSTRAINT `trips_aircraft_id_fkey` FOREIGN KEY (`aircraft_id`) REFERENCES `aircraft`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `trips` ADD CONSTRAINT `trips_tariff_id_fkey` FOREIGN KEY (`tariff_id`) REFERENCES `tariffs`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `trips` ADD CONSTRAINT `trips_created_by_id_fkey` FOREIGN KEY (`created_by_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `trips` ADD CONSTRAINT `trips_canceled_by_id_fkey` FOREIGN KEY (`canceled_by_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `aircraft_blocks` ADD CONSTRAINT `aircraft_blocks_aircraft_id_fkey` FOREIGN KEY (`aircraft_id`) REFERENCES `aircraft`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `aircraft_blocks` ADD CONSTRAINT `aircraft_blocks_created_by_id_fkey` FOREIGN KEY (`created_by_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `charges` ADD CONSTRAINT `charges_client_id_fkey` FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `charges` ADD CONSTRAINT `charges_trip_id_fkey` FOREIGN KEY (`trip_id`) REFERENCES `trips`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `charges` ADD CONSTRAINT `charges_created_by_id_fkey` FOREIGN KEY (`created_by_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `payments` ADD CONSTRAINT `payments_charge_id_fkey` FOREIGN KEY (`charge_id`) REFERENCES `charges`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `payments` ADD CONSTRAINT `payments_created_by_id_fkey` FOREIGN KEY (`created_by_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `payments` ADD CONSTRAINT `payments_reversed_by_id_fkey` FOREIGN KEY (`reversed_by_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `notifications` ADD CONSTRAINT `notifications_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `audit_logs` ADD CONSTRAINT `audit_logs_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

