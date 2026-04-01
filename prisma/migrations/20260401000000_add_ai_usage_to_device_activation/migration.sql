-- Add AI usage tracking columns to device_activations
ALTER TABLE "device_activations" ADD COLUMN "ai_daily_count" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "device_activations" ADD COLUMN "ai_daily_reset_at" DATETIME;
ALTER TABLE "device_activations" ADD COLUMN "ai_lifetime_count" INTEGER NOT NULL DEFAULT 0;
