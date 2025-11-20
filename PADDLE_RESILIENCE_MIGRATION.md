# Paddle Webhook Resilience Migration Guide

## Overview

This guide explains the resilience improvements made to the Paddle webhook processing system and how to migrate from the old implementation to the new one.

## What Was Improved

### 1. **Database Transactions** ✅
**Problem:** Operations were not atomic - if one step failed, previous steps remained committed, leading to inconsistent state.

**Solution:** All webhook processing now happens within database transactions. If any step fails, all changes are rolled back.

### 2. **Idempotency & Race Conditions** ✅
**Problem:** Duplicate webhooks arriving simultaneously could create multiple licenses for the same transaction.

**Solution:**
- Webhook events are tracked in a `webhook_events` table
- Event IDs are used for idempotency (same event returns cached result)
- Double-check within transactions prevents race conditions

### 3. **Email Delivery Resilience** ✅
**Problem:** Email failures would succeed the webhook but customer never received their license key. No retry mechanism.

**Solution:**
- Emails are queued in `email_queue` table
- Background job processes queue with exponential backoff (1min, 5min, 15min, 1hr, 4hr)
- Up to 5 retry attempts
- Failed emails can be manually retried via admin API
- Email failure doesn't fail the webhook

### 4. **Error Handling** ✅
**Problem:** All errors returned 500, causing Paddle to retry even for permanent failures. No distinction between retryable vs. non-retryable errors.

**Solution:**
- `WebhookError` class with `isRetryable` flag
- 401 for authentication failures (non-retryable)
- 400 for bad data (non-retryable)
- 500 for temporary failures (retryable)
- Network errors are retryable, validation errors are not

### 5. **Configuration Validation** ✅
**Problem:** Missing environment variables only discovered at runtime when webhook arrives.

**Solution:**
- `ConfigValidator` checks all required config at startup
- Server fails to start if critical config is missing
- Warnings for optional but recommended config

### 6. **Observability** ✅
**Problem:** No way to see failed webhooks, no metrics, email failures were logged but not trackable.

**Solution:**
- Admin API endpoints for monitoring:
  - `/admin/webhooks/stats` - Webhook processing stats
  - `/admin/webhooks/failed` - List failed webhooks
  - `/admin/email-queue/stats` - Email queue stats
  - `/admin/email-queue/failed` - List failed emails
- Comprehensive logging with structured context
- Webhook and email status tracking in database

## Database Schema Changes

Run the following migration to add the new tables:

```bash
npx prisma migrate dev --name add-webhook-resilience
```

### New Tables

**webhook_events:**
- Tracks all webhook processing attempts
- Provides idempotency via `source + eventId` unique constraint
- Stores processing status and error details

**email_queue:**
- Queues emails for reliable delivery
- Tracks retry attempts and backoff timing
- Stores delivery status and Mailgun message IDs

## Migration Steps

### Step 1: Update Database Schema

```bash
# Generate Prisma client with new tables
npx prisma generate

# Run migration
npx prisma migrate dev --name add-webhook-resilience

# Or for production
npx prisma migrate deploy
```

### Step 2: Update index.ts

Replace the old paddle route registration with:

```typescript
import { ConfigValidator } from './lib/config-validator';
import { BackgroundJobsService } from './services/background-jobs.service';

// In buildApp():
// Add configuration validation
const configResult = ConfigValidator.logValidation(fastify.log);
if (!configResult.valid) {
  throw new Error('Invalid configuration - server cannot start');
}

// Register admin routes
await fastify.register(import('./routes/admin'), { prefix: '/api' });

// Use resilient paddle routes
await fastify.register(import('./routes/paddle-resilient'), { prefix: '/api' });

// In start():
// Start background jobs after server starts
const backgroundJobs = new BackgroundJobsService(app.log);
backgroundJobs.start();

// Update graceful shutdown
const closeGracefully = async (signal: string) => {
  app.log.info(`Received ${signal}, closing server gracefully...`);
  backgroundJobs.stop();
  await prisma.$disconnect();
  await app.close();
  process.exit(0);
};
```

### Step 3: Test the Migration

1. **Test idempotency:**
   ```bash
   # Send the same webhook twice - should return cached result
   curl -X POST http://localhost:3000/api/paddle/webhook \
     -H "paddle-signature: ts=..." \
     -d '{"event_type": "transaction.completed", ...}'
   ```

2. **Test email queue:**
   ```bash
   # Check email queue stats
   curl http://localhost:3000/api/admin/email-queue/stats

   # Process queue manually
   curl -X POST http://localhost:3000/api/admin/email-queue/process
   ```

3. **Test configuration validation:**
   ```bash
   # Remove PADDLE_WEBHOOK_SECRET temporarily
   # Server should fail to start with clear error message
   ```

## Admin API Endpoints

### Email Queue Management

**GET /api/admin/email-queue/stats**
- Returns counts of emails by status (pending, sending, sent, failed, retrying)

**GET /api/admin/email-queue/failed**
- Lists failed emails for manual review
- Query params: `?limit=50`

**POST /api/admin/email-queue/process**
- Manually trigger email queue processing
- Query params: `?limit=10`

**POST /api/admin/email-queue/:emailId/retry**
- Manually retry a specific failed email

### Webhook Management

**GET /api/admin/webhooks/stats**
- Returns counts of webhooks by status
- Query params: `?source=paddle`

**GET /api/admin/webhooks/failed**
- Lists failed webhooks for manual review
- Query params: `?source=paddle&limit=50`

**POST /api/admin/webhooks/:webhookId/retry**
- Mark a failed webhook for retry (manual reprocessing required)

## Background Jobs

The email queue processor runs automatically every minute:
- Processes up to 10 pending emails per run
- Uses exponential backoff for retries
- Max 5 attempts per email
- Logs processing results

## Error Handling

### Retryable Errors (500)
- Network failures
- Paddle API timeouts
- Database connection issues
- External service unavailable

### Non-Retryable Errors (400/401)
- Invalid signature
- Missing required fields
- Invalid timestamp
- Customer not found
- Transaction already processed

## Monitoring Recommendations

### Key Metrics to Track
1. **Webhook processing rate:** webhooks completed vs. failed
2. **Email delivery rate:** emails sent vs. failed
3. **Retry rates:** How often are webhooks/emails retrying?
4. **Processing latency:** Time from webhook received to completed

### Alerts to Set Up
1. **Failed webhooks > 10** - Manual review needed
2. **Failed emails > 20** - Email service issue
3. **Email queue depth > 100** - Processing falling behind
4. **Config validation failed** - Server won't start

## Rollback Plan

If issues arise, you can rollback by:

1. Switch back to old paddle route:
   ```typescript
   await fastify.register(import('./routes/paddle'), { prefix: '/api' });
   ```

2. Stop background jobs

3. Old code will continue to work with new database schema (new tables are separate)

## Testing Checklist

- [ ] Configuration validation works at startup
- [ ] Webhooks are idempotent (duplicate webhooks return cached result)
- [ ] Transactions rollback on failure
- [ ] Emails are queued and processed by background job
- [ ] Failed emails can be retried manually
- [ ] Admin endpoints return correct stats
- [ ] Race conditions are prevented (concurrent webhook test)
- [ ] Error responses distinguish retryable vs. non-retryable
- [ ] Refund webhooks work correctly
- [ ] Background jobs start and stop gracefully

## Performance Considerations

- **Webhook processing:** Slightly slower due to transaction overhead (~10-20ms)
- **Email delivery:** Async - webhook returns immediately, email sent in background
- **Database growth:** Monitor `webhook_events` and `email_queue` tables - consider cleanup job for old completed records

## Next Steps

1. Deploy to staging environment
2. Test with Paddle sandbox webhooks
3. Monitor for 24 hours
4. Deploy to production
5. Monitor metrics and alerts
6. Set up automated cleanup of old webhook events (90+ days)

## Support

For issues or questions, refer to:
- Paddle webhook documentation: https://developer.paddle.com/webhooks/overview
- Webhook event logs in database: `webhook_events` table
- Email queue logs: `email_queue` table
- Application logs: Search for "Paddle webhook" or "Email queue"
