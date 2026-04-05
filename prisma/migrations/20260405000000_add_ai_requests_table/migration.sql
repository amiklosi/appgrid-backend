-- CreateTable
CREATE TABLE "ai_requests" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "machine_id" TEXT,
    "license_key" TEXT,
    "instruction" TEXT NOT NULL,
    "grid_snapshot" TEXT NOT NULL,
    "current_page" INTEGER,
    "max_items_per_page" INTEGER,
    "action" TEXT NOT NULL,
    "confidence" REAL NOT NULL DEFAULT 0,
    "reason" TEXT,
    "success" BOOLEAN NOT NULL DEFAULT false,
    "mutations" TEXT,
    "classifier_prompt" TEXT,
    "classifier_response" TEXT,
    "executor_model" TEXT,
    "executor_prompt" TEXT,
    "executor_response" TEXT,
    "input_tokens" INTEGER NOT NULL DEFAULT 0,
    "output_tokens" INTEGER NOT NULL DEFAULT 0,
    "cost_usd" REAL NOT NULL DEFAULT 0,
    "outcome" TEXT NOT NULL DEFAULT 'pending',
    "outcome_at" DATETIME,
    "outcome_reason" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "duration_ms" INTEGER
);

-- CreateIndex
CREATE INDEX "ai_requests_machine_id_idx" ON "ai_requests"("machine_id");

-- CreateIndex
CREATE INDEX "ai_requests_license_key_idx" ON "ai_requests"("license_key");

-- CreateIndex
CREATE INDEX "ai_requests_outcome_idx" ON "ai_requests"("outcome");

-- CreateIndex
CREATE INDEX "ai_requests_created_at_idx" ON "ai_requests"("created_at");
