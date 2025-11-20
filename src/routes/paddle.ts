import { FastifyPluginAsync } from 'fastify';
import { createHmac } from 'crypto';
import { prisma } from '../lib/prisma';
import { LicenseService } from '../services/license.service';
import { emailService } from '../lib/email';
import { EmailQueueService } from '../services/email-queue.service';
import { WebhookService, WebhookError } from '../services/webhook.service';
import { retry } from '../lib/retry';

const paddleRoutes: FastifyPluginAsync = async (fastify) => {
  // Paddle webhook endpoint for transaction.completed events
  fastify.post('/paddle/webhook', async (request, reply) => {
    try {
      // 1. Configuration validation
      const webhookSecret = process.env.PADDLE_WEBHOOK_SECRET;
      if (!webhookSecret) {
        fastify.log.error('PADDLE_WEBHOOK_SECRET not configured');
        throw new WebhookError('Paddle webhook not configured', false, 500);
      }

      // 2. Verify webhook signature
      const signature = request.headers['paddle-signature'] as string;
      if (!signature) {
        fastify.log.warn('Missing Paddle signature header');
        throw new WebhookError('Missing signature', false, 401);
      }

      // Parse signature header (Format: ts=timestamp;h1=signature)
      const signatureParts = signature.split(';');
      const timestampPart = signatureParts.find((part) => part.startsWith('ts='));
      const signaturePart = signatureParts.find((part) => part.startsWith('h1='));

      if (!timestampPart || !signaturePart) {
        fastify.log.warn('Invalid signature format');
        throw new WebhookError('Invalid signature format', false, 401);
      }

      const timestamp = timestampPart.replace('ts=', '');
      const providedSignature = signaturePart.replace('h1=', '');

      // Verify signature
      const payload = request.body as any;
      const signedPayload = `${timestamp}:${JSON.stringify(payload)}`;
      const expectedSignature = createHmac('sha256', webhookSecret)
        .update(signedPayload)
        .digest('hex');

      if (expectedSignature !== providedSignature) {
        fastify.log.warn({ providedSignature, expectedSignature }, 'Invalid webhook signature');
        throw new WebhookError('Invalid signature', false, 401);
      }

      // 3. Check timestamp to prevent replay attacks (within 5 minutes)
      const timestampMs = parseInt(timestamp, 10) * 1000;
      const now = Date.now();
      const fiveMinutes = 5 * 60 * 1000;
      if (Math.abs(now - timestampMs) > fiveMinutes) {
        fastify.log.warn('Webhook timestamp too old or in future');
        throw new WebhookError('Invalid timestamp', false, 401);
      }

      // 4. Extract event info
      const eventType = payload.event_type;
      const data = payload.data;

      if (!eventType || !data) {
        throw new WebhookError('Missing event_type or data in payload', false, 400);
      }

      fastify.log.info({ eventType, transactionId: data?.id }, 'Received Paddle webhook');

      // 5. Route to appropriate handler
      if (eventType === 'transaction.completed') {
        return await handleTransactionCompleted(fastify, payload, data);
      }

      if (eventType === 'adjustment.updated') {
        return await handleAdjustmentUpdated(fastify, payload, data);
      }

      // For other event types, just acknowledge
      return reply.send({ success: true, message: 'Event acknowledged' });
    } catch (error: any) {
      fastify.log.error({ error: error.message, stack: error.stack }, 'Webhook processing failed');

      if (error instanceof WebhookError) {
        return reply.code(error.statusCode).send({
          success: false,
          error: error.message,
          retryable: error.isRetryable,
        });
      }

      // Unknown errors are retryable by default
      return reply.code(500).send({
        success: false,
        error: error.message || 'Webhook processing failed',
        retryable: true,
      });
    }
  });
};

/**
 * Handle transaction.completed event with full resilience
 */
async function handleTransactionCompleted(fastify: any, payload: any, data: any) {
  const transactionId = data.id;

  // Use webhook service for idempotency
  const { result, isNewEvent } = await WebhookService.processWebhook(
    {
      source: 'paddle',
      eventType: 'transaction.completed',
      eventId: transactionId,
      payload,
    },
    async () => {
      // Process the transaction
      const customerId = data.customer_id;
      const status = data.status;

      fastify.log.info({ transactionId, customerId, status }, 'Processing transaction.completed event');

      // Business logic validation
      if (status !== 'completed') {
        fastify.log.info({ transactionId, status }, 'Transaction not completed, skipping');
        throw new WebhookError('Transaction not completed', false, 200);
      }

      if (!customerId) {
        fastify.log.error({ transactionId }, 'No customer ID in transaction');
        throw new WebhookError('No customer ID found', false, 400);
      }

      // Fetch customer details from Paddle API
      const customerDetails = await fetchPaddleCustomer(fastify, customerId, transactionId);

      // Process purchase in a database transaction for atomicity
      const result = await prisma.$transaction(async (tx) => {
        // Double-check for existing purchase (race condition protection)
        const existingPurchase = await tx.paddlePurchase.findUnique({
          where: { paddleTransactionId: transactionId },
          include: { license: true, user: true },
        });

        if (existingPurchase) {
          fastify.log.info(
            { transactionId, licenseKey: existingPurchase.license.licenseKey },
            'Transaction already processed (in transaction check)'
          );
          return {
            alreadyProcessed: true,
            licenseKey: existingPurchase.license.licenseKey,
            email: existingPurchase.email,
            userId: existingPurchase.userId,
            licenseId: existingPurchase.licenseId,
          };
        }

        // Determine license type and expiration
        const licenseConfig = determineLicenseConfig(data);

        // Create or find user
        let user = await tx.user.findUnique({
          where: { email: customerDetails.email },
        });

        if (!user) {
          user = await tx.user.create({
            data: {
              email: customerDetails.email,
              name: customerDetails.name,
              marketingConsent: customerDetails.marketingConsent,
            },
          });
          fastify.log.info(
            { userId: user.id, email: customerDetails.email, marketingConsent: customerDetails.marketingConsent },
            'Created new user'
          );
        } else if (user.marketingConsent !== customerDetails.marketingConsent) {
          user = await tx.user.update({
            where: { id: user.id },
            data: { marketingConsent: customerDetails.marketingConsent },
          });
          fastify.log.info(
            { userId: user.id, email: customerDetails.email, marketingConsent: customerDetails.marketingConsent },
            'Updated user marketing consent'
          );
        }

        // Create license
        const license = await LicenseService.createLicense(
          {
            userId: user.id,
            expiresAt: licenseConfig.expiresAt?.toISOString(),
            maxActivations: licenseConfig.maxActivations,
            notes: `Paddle purchase - Transaction: ${transactionId}`,
            metadata: {
              source: 'paddle',
              transactionId,
              customerId,
              paddleData: data,
            },
          },
          tx
        );

        fastify.log.info({ transactionId, email: customerDetails.email, licenseKey: license.licenseKey }, 'Created new license');

        // Create purchase record
        await tx.paddlePurchase.create({
          data: {
            paddleTransactionId: transactionId,
            paddleCustomerId: customerId,
            email: customerDetails.email,
            licenseId: license.id,
            userId: user.id,
            emailSent: false, // Will be handled by queue
            paddleData: data,
          },
        });

        return {
          alreadyProcessed: false,
          licenseKey: license.licenseKey,
          email: customerDetails.email,
          userId: user.id,
          licenseId: license.id,
          isLifetime: licenseConfig.isLifetime,
          expiresAt: licenseConfig.expiresAt,
          maxActivations: licenseConfig.maxActivations,
        };
      });

      // Queue email outside of transaction for better resilience
      if (!result.alreadyProcessed) {
        try {
          const template = emailService.renderTemplateForQueue('paddle-license', {
            licenseKey: result.licenseKey,
            isLifetime: result.isLifetime,
            expirationDate: result.expiresAt?.toLocaleDateString('en-US', {
              year: 'numeric',
              month: 'long',
              day: 'numeric',
            }),
            maxActivations: result.maxActivations,
          });

          await EmailQueueService.queueEmail({
            to: result.email,
            subject: template.subject,
            textContent: template.text,
            htmlContent: template.html,
            metadata: {
              type: 'paddle-license',
              transactionId,
              licenseId: result.licenseId,
              userId: result.userId,
            },
          });

          fastify.log.info({ transactionId, email: result.email }, 'Email queued for delivery');
        } catch (emailError: any) {
          // Email queueing failed, but purchase succeeded
          // Log error but don't fail the webhook
          fastify.log.error(
            { transactionId, email: result.email, error: emailError.message },
            'Failed to queue email, but purchase succeeded'
          );
        }
      }

      return {
        licenseKey: result.licenseKey,
        email: result.email,
        alreadyProcessed: result.alreadyProcessed,
      };
    }
  );

  return {
    success: true,
    ...result,
    isNewEvent,
  };
}

/**
 * Handle adjustment.updated event (refunds)
 */
async function handleAdjustmentUpdated(fastify: any, payload: any, data: any) {
  const adjustmentId = data.id;
  const transactionId = data.transaction_id;

  // Use webhook service for idempotency
  const { result, isNewEvent } = await WebhookService.processWebhook(
    {
      source: 'paddle',
      eventType: 'adjustment.updated',
      eventId: adjustmentId,
      payload,
    },
    async () => {
      const adjustmentStatus = data.status;
      const action = data.action;

      fastify.log.info({ adjustmentId, transactionId, adjustmentStatus, action }, 'Received adjustment.updated event');

      // Only process approved refunds
      if (adjustmentStatus !== 'approved' || action !== 'refund') {
        return { success: true, message: 'Adjustment acknowledged (not a refund)' };
      }

      // Process refund in transaction
      const result = await prisma.$transaction(async (tx) => {
        const purchase = await tx.paddlePurchase.findUnique({
          where: { paddleTransactionId: transactionId },
          include: { license: true, user: true },
        });

        if (!purchase) {
          fastify.log.warn({ adjustmentId, transactionId }, 'Refund received but no purchase found');
          return { success: true, message: 'No purchase found for refund' };
        }

        if (purchase.license.status === 'REVOKED') {
          fastify.log.info({ adjustmentId, transactionId, licenseId: purchase.license.id }, 'License already revoked');
          return { success: true, message: 'License already revoked' };
        }

        // Revoke the license
        await tx.license.update({
          where: { id: purchase.license.id },
          data: {
            status: 'REVOKED',
            revokedAt: new Date(),
            notes: `Revoked due to refund - Adjustment: ${adjustmentId}, Transaction: ${transactionId}`,
          },
        });

        fastify.log.info(
          {
            adjustmentId,
            transactionId,
            licenseId: purchase.license.id,
            licenseKey: purchase.license.licenseKey,
            userEmail: purchase.user.email,
          },
          'License revoked due to refund'
        );

        return {
          success: true,
          message: 'License revoked',
          licenseId: purchase.license.id,
        };
      });

      return result;
    }
  );

  return {
    ...result,
    isNewEvent,
  };
}

/**
 * Fetch customer details from Paddle API with error handling and retry
 */
async function fetchPaddleCustomer(fastify: any, customerId: string, transactionId: string) {
  const paddleApiKey = process.env.PADDLE_API_KEY;
  if (!paddleApiKey) {
    fastify.log.error('PADDLE_API_KEY not configured');
    throw new WebhookError('Paddle API not configured', false, 500);
  }

  // Detect sandbox vs production
  const isSandbox = paddleApiKey.includes('_sdbx_');
  const paddleApiUrl = isSandbox ? 'https://sandbox-api.paddle.com' : 'https://api.paddle.com';

  try {
    // Retry the fetch with exponential backoff
    return await retry(
      async () => {
        const customerResponse = await fetch(`${paddleApiUrl}/customers/${customerId}`, {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${paddleApiKey}`,
            'Content-Type': 'application/json',
          },
        });

        if (!customerResponse.ok) {
          const errorText = await customerResponse.text();
          fastify.log.error(
            { transactionId, customerId, status: customerResponse.status, error: errorText },
            'Failed to fetch customer from Paddle API'
          );

          // Determine if this is retryable
          const isRetryable = customerResponse.status >= 500 || customerResponse.status === 429;
          const error = new WebhookError('Failed to fetch customer details', isRetryable, 500);
          (error as any).statusCode = customerResponse.status;
          throw error;
        }

        const customerData = (await customerResponse.json()) as any;
        const customerEmail = customerData.data?.email;
        const customerName = customerData.data?.name || null;
        const marketingConsent = customerData.data?.marketing_consent || false;

        if (!customerEmail) {
          fastify.log.error({ transactionId, customerId, customerData }, 'No email in customer data');
          throw new WebhookError('Customer email not found', false, 400);
        }

        fastify.log.info({ transactionId, customerId, customerEmail, marketingConsent }, 'Fetched customer details from Paddle');

        return {
          email: customerEmail,
          name: customerName,
          marketingConsent,
        };
      },
      {
        maxAttempts: 3,
        baseDelayMs: 1000, // 1s, 2s, 4s
        shouldRetry: (error) => {
          // Only retry if error is marked as retryable
          if (error instanceof WebhookError) {
            return error.isRetryable;
          }
          // Network errors are retryable
          return true;
        },
        onRetry: (attempt, error) => {
          fastify.log.warn(
            { transactionId, customerId, attempt, error: error.message },
            'Retrying Paddle customer fetch'
          );
        },
      }
    );
  } catch (error: any) {
    // All retries failed - send alert email
    const statusCode = (error as any).statusCode || 'unknown';

    fastify.log.error(
      { transactionId, customerId, error: error.message, statusCode },
      'Failed to fetch customer after all retries - sending alert'
    );

    // Send alert email asynchronously (don't wait for it)
    emailService
      .sendAlertEmail(
        'Paddle Customer Fetch Failed',
        `Failed to fetch customer details from Paddle API after 3 retry attempts.\n\nTransaction ID: ${transactionId}\nCustomer ID: ${customerId}\nError: ${error.message}`,
        {
          transactionId,
          customerId,
          statusCode,
          error: error.message,
          paddleApiUrl,
          isSandbox,
        }
      )
      .catch((alertError) => {
        fastify.log.error({ alertError: alertError.message }, 'Failed to send alert email');
      });

    // Re-throw the error
    if (error instanceof WebhookError) {
      throw error;
    }

    // Network errors are retryable
    throw new WebhookError('Failed to fetch customer details', true, 500);
  }
}

/**
 * Determine license configuration from transaction data
 */
function determineLicenseConfig(data: any) {
  const items = data.items || [];
  let isLifetime = false;
  let expiresAt: Date | undefined = undefined;
  const maxActivations = 5; // Default

  for (const item of items) {
    const productName = item.price?.product?.name?.toLowerCase() || '';
    const billingCycle = item.price?.billing_cycle;

    if (productName.includes('lifetime') || billingCycle === null) {
      isLifetime = true;
      expiresAt = undefined;
    } else if (billingCycle) {
      const interval = billingCycle.interval;
      const frequency = billingCycle.frequency;

      if (interval === 'year') {
        const years = frequency || 1;
        expiresAt = new Date();
        expiresAt.setFullYear(expiresAt.getFullYear() + years);
      } else if (interval === 'month') {
        const months = frequency || 1;
        expiresAt = new Date();
        expiresAt.setMonth(expiresAt.getMonth() + months);
      }
    }
  }

  return { isLifetime, expiresAt, maxActivations };
}

export default paddleRoutes;
