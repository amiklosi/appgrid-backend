-- Drop the unique index if it was created (reverted decision: existing data
-- can have multiple activations per fingerprint across different licenses).
DROP INDEX IF EXISTS "device_activations_device_fingerprint_key";

-- Ensure the non-unique index exists for query performance.
CREATE INDEX IF NOT EXISTS "device_activations_device_fingerprint_idx" ON "device_activations"("device_fingerprint");
