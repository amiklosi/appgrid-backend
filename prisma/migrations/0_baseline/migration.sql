-- Baseline migration: reflects the schema already present on prod/staging.
-- This migration is marked as applied via `prisma migrate resolve --applied`
-- and will never be executed against an existing database.

-- Enums
CREATE TYPE "LicenseStatus" AS ENUM ('ACTIVE', 'EXPIRED', 'REVOKED', 'SUSPENDED');
CREATE TYPE "EmailStatus" AS ENUM ('PENDING', 'SENDING', 'SENT', 'FAILED', 'RETRYING');
CREATE TYPE "WebhookStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'RETRYING');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "company" TEXT,
    "marketing_consent" BOOLEAN,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "licenses" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "license_key" TEXT NOT NULL,
    "status" "LicenseStatus" NOT NULL DEFAULT 'ACTIVE',
    "issued_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3),
    "activated_at" TIMESTAMP(3),
    "revoked_at" TIMESTAMP(3),
    "max_activations" INTEGER NOT NULL DEFAULT 1,
    "is_trial" BOOLEAN NOT NULL DEFAULT false,
    "metadata" JSONB,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "licenses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "license_validations" (
    "id" TEXT NOT NULL,
    "license_id" TEXT NOT NULL,
    "is_valid" BOOLEAN NOT NULL,
    "validation_message" TEXT,
    "ip_address" TEXT,
    "user_agent" TEXT,
    "device_fingerprint" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "license_validations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "device_activations" (
    "id" TEXT NOT NULL,
    "license_id" TEXT NOT NULL,
    "device_fingerprint" TEXT NOT NULL,
    "device_name" TEXT,
    "ip_address" TEXT,
    "user_agent" TEXT,
    "activated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "device_activations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "revenuecat_migrations" (
    "id" TEXT NOT NULL,
    "revenuecat_user_id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "license_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "email_sent" BOOLEAN NOT NULL DEFAULT false,
    "email_sent_at" TIMESTAMP(3),
    "revenuecat_data" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "revenuecat_migrations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "paddle_purchases" (
    "id" TEXT NOT NULL,
    "paddle_transaction_id" TEXT NOT NULL,
    "paddle_customer_id" TEXT,
    "email" TEXT NOT NULL,
    "license_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "email_sent" BOOLEAN NOT NULL DEFAULT false,
    "email_sent_at" TIMESTAMP(3),
    "purchase_price" INTEGER,
    "tax_amount" INTEGER,
    "currency" TEXT,
    "paddle_data" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "paddle_purchases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhook_events" (
    "id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "event_id" TEXT,
    "payload" JSONB NOT NULL,
    "status" "WebhookStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,
    "last_attempt_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "webhook_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "email_queue" (
    "id" TEXT NOT NULL,
    "to" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "text_content" TEXT NOT NULL,
    "html_content" TEXT NOT NULL,
    "status" "EmailStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "max_attempts" INTEGER NOT NULL DEFAULT 5,
    "last_error" TEXT,
    "last_attempt_at" TIMESTAMP(3),
    "next_retry_at" TIMESTAMP(3),
    "sent_at" TIMESTAMP(3),
    "message_id" TEXT,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "email_queue_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "licenses_license_key_key" ON "licenses"("license_key");
CREATE INDEX "licenses_user_id_idx" ON "licenses"("user_id");
CREATE INDEX "licenses_status_idx" ON "licenses"("status");
CREATE INDEX "licenses_expires_at_idx" ON "licenses"("expires_at");

-- CreateIndex
CREATE INDEX "license_validations_license_id_idx" ON "license_validations"("license_id");
CREATE INDEX "license_validations_created_at_idx" ON "license_validations"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "device_activations_license_id_device_fingerprint_key" ON "device_activations"("license_id", "device_fingerprint");
CREATE INDEX "device_activations_license_id_idx" ON "device_activations"("license_id");
CREATE INDEX "device_activations_device_fingerprint_idx" ON "device_activations"("device_fingerprint");

-- CreateIndex
CREATE UNIQUE INDEX "revenuecat_migrations_revenuecat_user_id_key" ON "revenuecat_migrations"("revenuecat_user_id");
CREATE INDEX "revenuecat_migrations_email_idx" ON "revenuecat_migrations"("email");
CREATE INDEX "revenuecat_migrations_revenuecat_user_id_idx" ON "revenuecat_migrations"("revenuecat_user_id");
CREATE INDEX "revenuecat_migrations_created_at_idx" ON "revenuecat_migrations"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "paddle_purchases_paddle_transaction_id_key" ON "paddle_purchases"("paddle_transaction_id");
CREATE INDEX "paddle_purchases_email_idx" ON "paddle_purchases"("email");
CREATE INDEX "paddle_purchases_paddle_transaction_id_idx" ON "paddle_purchases"("paddle_transaction_id");
CREATE INDEX "paddle_purchases_paddle_customer_id_idx" ON "paddle_purchases"("paddle_customer_id");
CREATE INDEX "paddle_purchases_created_at_idx" ON "paddle_purchases"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "webhook_events_source_event_id_key" ON "webhook_events"("source", "event_id");
CREATE INDEX "webhook_events_status_idx" ON "webhook_events"("status");
CREATE INDEX "webhook_events_source_event_type_idx" ON "webhook_events"("source", "event_type");
CREATE INDEX "webhook_events_created_at_idx" ON "webhook_events"("created_at");

-- CreateIndex
CREATE INDEX "email_queue_status_idx" ON "email_queue"("status");
CREATE INDEX "email_queue_next_retry_at_idx" ON "email_queue"("next_retry_at");
CREATE INDEX "email_queue_created_at_idx" ON "email_queue"("created_at");

-- AddForeignKey
ALTER TABLE "licenses" ADD CONSTRAINT "licenses_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "license_validations" ADD CONSTRAINT "license_validations_license_id_fkey" FOREIGN KEY ("license_id") REFERENCES "licenses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "device_activations" ADD CONSTRAINT "device_activations_license_id_fkey" FOREIGN KEY ("license_id") REFERENCES "licenses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "revenuecat_migrations" ADD CONSTRAINT "revenuecat_migrations_license_id_fkey" FOREIGN KEY ("license_id") REFERENCES "licenses"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "revenuecat_migrations" ADD CONSTRAINT "revenuecat_migrations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "paddle_purchases" ADD CONSTRAINT "paddle_purchases_license_id_fkey" FOREIGN KEY ("license_id") REFERENCES "licenses"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "paddle_purchases" ADD CONSTRAINT "paddle_purchases_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
