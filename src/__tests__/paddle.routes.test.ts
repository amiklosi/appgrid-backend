import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { prismaMock } from './setup';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../index';
import * as emailLib from '../lib/email';
import * as emailQueueService from '../services/email-queue.service';
import { createHmac } from 'crypto';

// Mock services
vi.mock('../lib/email', () => ({
  emailService: {
    sendPaddleLicenseEmail: vi.fn(),
    renderTemplateForQueue: vi.fn(),
    sendAlertEmail: vi.fn(),
  },
}));

vi.mock('../services/email-queue.service', () => ({
  EmailQueueService: {
    queueEmail: vi.fn(),
  },
}));

// Mock fetch globally
global.fetch = vi.fn();

describe('Paddle Webhook Routes', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    vi.clearAllMocks();
    process.env.PADDLE_WEBHOOK_SECRET = 'test-webhook-secret';
    process.env.PADDLE_API_KEY = 'test_paddle_api_key';
    process.env.MAILGUN_API_KEY = 'test-mailgun-key';
    process.env.MAILGUN_DOMAIN = 'test.mailgun.org';

    app = await buildApp();
    await app.ready();
  });

  afterEach(async () => {
    if (app) {
      await app.close();
    }
  });

  /**
   * Helper to create valid Paddle webhook signature
   */
  function createValidSignature(payload: any, timestamp: string): string {
    const secret = process.env.PADDLE_WEBHOOK_SECRET!;
    const signedPayload = `${timestamp}:${JSON.stringify(payload)}`;
    const signature = createHmac('sha256', secret).update(signedPayload).digest('hex');
    return `ts=${timestamp};h1=${signature}`;
  }

  /**
   * Mock Paddle customer API response
   */
  function mockPaddleCustomerApi(customerData: any) {
    (global.fetch as any).mockResolvedValue({
      ok: true,
      json: async () => ({ data: customerData }),
    });
  }

  describe('POST /api/paddle/webhook - Signature Verification', () => {
    it('should reject webhook without signature header', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/paddle/webhook',
        headers: { 'content-type': 'application/json' },
        payload: { event_type: 'transaction.completed', data: {} },
      });

      expect(response.statusCode).toBe(401);
      expect(JSON.parse(response.body)).toMatchObject({
        success: false,
        error: 'Missing signature',
      });
    });

    it('should reject webhook with invalid signature format', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/paddle/webhook',
        headers: {
          'content-type': 'application/json',
          'paddle-signature': 'invalid-format',
        },
        payload: { event_type: 'transaction.completed', data: {} },
      });

      expect(response.statusCode).toBe(401);
      expect(JSON.parse(response.body)).toMatchObject({
        success: false,
        error: 'Invalid signature format',
      });
    });

    it('should reject webhook with incorrect signature', async () => {
      const timestamp = Math.floor(Date.now() / 1000).toString();
      const response = await app.inject({
        method: 'POST',
        url: '/api/paddle/webhook',
        headers: {
          'content-type': 'application/json',
          'paddle-signature': `ts=${timestamp};h1=wrong-signature`,
        },
        payload: { event_type: 'transaction.completed', data: {} },
      });

      expect(response.statusCode).toBe(401);
      expect(JSON.parse(response.body)).toMatchObject({
        success: false,
        error: 'Invalid signature',
      });
    });

    it('should reject webhook with old timestamp', async () => {
      const oldTimestamp = Math.floor((Date.now() - 10 * 60 * 1000) / 1000).toString(); // 10 minutes ago
      const payload = { event_type: 'transaction.completed', data: {} };
      const signature = createValidSignature(payload, oldTimestamp);

      const response = await app.inject({
        method: 'POST',
        url: '/api/paddle/webhook',
        headers: {
          'content-type': 'application/json',
          'paddle-signature': signature,
        },
        payload,
      });

      expect(response.statusCode).toBe(401);
      expect(JSON.parse(response.body)).toMatchObject({
        success: false,
        error: 'Invalid timestamp',
      });
    });

    it('should accept webhook with valid signature', async () => {
      const timestamp = Math.floor(Date.now() / 1000).toString();
      const payload = {
        event_type: 'transaction.completed',
        data: {
          id: 'txn_test',
          customer_id: 'ctm_test',
          status: 'completed',
          items: [],
        },
      };
      const signature = createValidSignature(payload, timestamp);

      // Mock webhook event creation
      prismaMock.webhookEvent.upsert.mockResolvedValue({
        id: 'webhook-1',
        source: 'paddle',
        eventType: 'transaction.completed',
        eventId: 'txn_test',
        payload,
        status: 'PROCESSING',
        attempts: 1,
        lastAttemptAt: new Date(),
        lastError: null,
        completedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as any);

      prismaMock.webhookEvent.update.mockResolvedValue({} as any);

      // Mock Paddle customer API
      mockPaddleCustomerApi({
        email: 'test@example.com',
        name: 'Test User',
        marketing_consent: false,
      });

      // Mock transaction
      prismaMock.$transaction.mockImplementation(async (callback: any) => {
        return callback(prismaMock);
      });

      // Mock database operations
      prismaMock.paddlePurchase.findUnique.mockResolvedValue(null);
      prismaMock.user.findUnique.mockResolvedValue(null);
      prismaMock.user.create.mockResolvedValue({
        id: 'user-1',
        email: 'test@example.com',
        name: 'Test User',
        company: null,
        marketingConsent: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      prismaMock.license.create.mockResolvedValue({
        id: 'license-1',
        userId: 'user-1',
        licenseKey: 'TEST-KEY1-KEY2-KEY3',
        status: 'ACTIVE',
        issuedAt: new Date(),
        expiresAt: null,
        activatedAt: null,
        revokedAt: null,
        maxActivations: 5,
        metadata: null,
        notes: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as any);

      prismaMock.paddlePurchase.create.mockResolvedValue({} as any);

      // Mock email queueing
      vi.mocked(emailLib.emailService.renderTemplateForQueue).mockReturnValue({
        subject: 'Your License',
        text: 'License text',
        html: '<p>License html</p>',
      });
      vi.mocked(emailQueueService.EmailQueueService.queueEmail).mockResolvedValue({} as any);

      const response = await app.inject({
        method: 'POST',
        url: '/api/paddle/webhook',
        headers: {
          'content-type': 'application/json',
          'paddle-signature': signature,
        },
        payload,
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
    });
  });

  describe('POST /api/paddle/webhook - Transaction Completed', () => {
    let validPayload: any;
    let timestamp: string;
    let signature: string;

    beforeEach(() => {
      timestamp = Math.floor(Date.now() / 1000).toString();
      validPayload = {
        event_type: 'transaction.completed',
        data: {
          id: 'txn_12345',
          customer_id: 'ctm_12345',
          status: 'completed',
          items: [
            {
              price: {
                product: { name: 'AppGrid License' },
                billing_cycle: null, // Lifetime
              },
            },
          ],
        },
      };
      signature = createValidSignature(validPayload, timestamp);
    });

    it('should process new purchase and create license', async () => {
      // Mock webhook tracking
      prismaMock.webhookEvent.upsert.mockResolvedValue({
        id: 'webhook-1',
        source: 'paddle',
        eventType: 'transaction.completed',
        eventId: 'txn_12345',
        payload: validPayload,
        status: 'PROCESSING',
        attempts: 1,
        lastAttemptAt: new Date(),
        lastError: null,
        completedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as any);

      prismaMock.webhookEvent.update.mockResolvedValue({} as any);

      // Mock Paddle customer API
      mockPaddleCustomerApi({
        email: 'customer@example.com',
        name: 'John Doe',
        marketing_consent: true,
      });

      // Mock transaction and database operations
      prismaMock.$transaction.mockImplementation(async (callback: any) => {
        return callback(prismaMock);
      });

      prismaMock.paddlePurchase.findUnique.mockResolvedValue(null);
      prismaMock.user.findUnique.mockResolvedValue(null);
      prismaMock.user.create.mockResolvedValue({
        id: 'user-1',
        email: 'customer@example.com',
        name: 'John Doe',
        company: null,
        marketingConsent: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      prismaMock.license.create.mockResolvedValue({
        id: 'license-1',
        userId: 'user-1',
        licenseKey: 'ABCD-EFGH-IJKL-MNOP',
        status: 'ACTIVE',
        issuedAt: new Date(),
        expiresAt: null,
        activatedAt: null,
        revokedAt: null,
        maxActivations: 5,
        metadata: { source: 'paddle' },
        notes: 'Paddle purchase - Transaction: txn_12345',
        createdAt: new Date(),
        updatedAt: new Date(),
      } as any);

      prismaMock.paddlePurchase.create.mockResolvedValue({} as any);

      // Mock email queueing
      vi.mocked(emailLib.emailService.renderTemplateForQueue).mockReturnValue({
        subject: 'Your AppGrid License Key',
        text: 'License text',
        html: '<p>License html</p>',
      });
      vi.mocked(emailQueueService.EmailQueueService.queueEmail).mockResolvedValue({} as any);

      const response = await app.inject({
        method: 'POST',
        url: '/api/paddle/webhook',
        headers: {
          'content-type': 'application/json',
          'paddle-signature': signature,
        },
        payload: validPayload,
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
      expect(body.licenseKey).toBe('ABCD-EFGH-IJKL-MNOP');

      // Verify email was queued
      expect(emailQueueService.EmailQueueService.queueEmail).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'customer@example.com',
          subject: 'Your AppGrid License Key',
        })
      );

      // Verify purchase record was created
      expect(prismaMock.paddlePurchase.create).toHaveBeenCalled();
    });

    it('should return cached result for duplicate webhook', async () => {
      // Mock webhook already exists
      prismaMock.webhookEvent.findUnique.mockResolvedValue({
        id: 'webhook-1',
        source: 'paddle',
        eventType: 'transaction.completed',
        eventId: 'txn_12345',
        payload: validPayload,
        status: 'COMPLETED',
        attempts: 1,
        lastAttemptAt: new Date(),
        lastError: null,
        completedAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      } as any);

      const response = await app.inject({
        method: 'POST',
        url: '/api/paddle/webhook',
        headers: {
          'content-type': 'application/json',
          'paddle-signature': signature,
        },
        payload: validPayload,
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.isNewEvent).toBe(false);

      // Should not create new records
      expect(prismaMock.license.create).not.toHaveBeenCalled();
      expect(prismaMock.paddlePurchase.create).not.toHaveBeenCalled();
    });

    it('should skip non-completed transactions', async () => {
      const pendingPayload = {
        ...validPayload,
        data: { ...validPayload.data, status: 'pending' },
      };
      const pendingSignature = createValidSignature(pendingPayload, timestamp);

      prismaMock.webhookEvent.upsert.mockResolvedValue({} as any);
      prismaMock.webhookEvent.update.mockResolvedValue({} as any);

      mockPaddleCustomerApi({
        email: 'customer@example.com',
        name: 'John Doe',
        marketing_consent: false,
      });

      const response = await app.inject({
        method: 'POST',
        url: '/api/paddle/webhook',
        headers: {
          'content-type': 'application/json',
          'paddle-signature': pendingSignature,
        },
        payload: pendingPayload,
      });

      expect(response.statusCode).toBe(200);

      // Should not create license for pending transaction
      expect(prismaMock.license.create).not.toHaveBeenCalled();
    });

    it('should handle customer API failure with retry', async () => {
      prismaMock.webhookEvent.upsert.mockResolvedValue({} as any);
      prismaMock.webhookEvent.update.mockResolvedValue({} as any);

      // Mock customer API failure (retryable)
      (global.fetch as any)
        .mockResolvedValueOnce({
          ok: false,
          status: 503,
          text: async () => 'Service Unavailable',
        })
        .mockResolvedValueOnce({
          ok: false,
          status: 503,
          text: async () => 'Service Unavailable',
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            data: {
              email: 'customer@example.com',
              name: 'John Doe',
              marketing_consent: false,
            },
          }),
        });

      prismaMock.$transaction.mockImplementation(async (callback: any) => {
        return callback(prismaMock);
      });

      prismaMock.paddlePurchase.findUnique.mockResolvedValue(null);
      prismaMock.user.findUnique.mockResolvedValue(null);
      prismaMock.user.create.mockResolvedValue({
        id: 'user-1',
        email: 'customer@example.com',
        name: 'John Doe',
        company: null,
        marketingConsent: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      prismaMock.license.create.mockResolvedValue({
        id: 'license-1',
        userId: 'user-1',
        licenseKey: 'TEST-1234-5678-9012',
        status: 'ACTIVE',
        issuedAt: new Date(),
        expiresAt: null,
        activatedAt: null,
        revokedAt: null,
        maxActivations: 5,
        metadata: null,
        notes: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as any);

      prismaMock.paddlePurchase.create.mockResolvedValue({} as any);

      vi.mocked(emailLib.emailService.renderTemplateForQueue).mockReturnValue({
        subject: 'Your License',
        text: 'License text',
        html: '<p>License html</p>',
      });
      vi.mocked(emailQueueService.EmailQueueService.queueEmail).mockResolvedValue({} as any);

      const response = await app.inject({
        method: 'POST',
        url: '/api/paddle/webhook',
        headers: {
          'content-type': 'application/json',
          'paddle-signature': signature,
        },
        payload: validPayload,
      });

      expect(response.statusCode).toBe(200);

      // Should have retried 3 times total
      expect(global.fetch).toHaveBeenCalledTimes(3);
    });

    it('should send alert email when customer fetch fails after retries', async () => {
      prismaMock.webhookEvent.upsert.mockResolvedValue({} as any);
      prismaMock.webhookEvent.update.mockResolvedValue({} as any);

      // Mock customer API permanent failure
      (global.fetch as any).mockResolvedValue({
        ok: false,
        status: 503,
        text: async () => 'Service Unavailable',
      });

      vi.mocked(emailLib.emailService.sendAlertEmail).mockResolvedValue({
        success: true,
        messageId: 'alert-123',
      });

      const response = await app.inject({
        method: 'POST',
        url: '/api/paddle/webhook',
        headers: {
          'content-type': 'application/json',
          'paddle-signature': signature,
        },
        payload: validPayload,
      });

      // Returns 500 for retryable errors (tells Paddle to retry)
      expect(response.statusCode).toBe(500);
      const body = JSON.parse(response.body);
      expect(body.retryable).toBe(true);

      // Should have sent alert email
      expect(emailLib.emailService.sendAlertEmail).toHaveBeenCalledWith(
        'Paddle Customer Fetch Failed',
        expect.stringContaining('Failed to fetch customer details'),
        expect.objectContaining({
          transactionId: 'txn_12345',
          customerId: 'ctm_12345',
          paddleStatus: 503,
        })
      );
    });
  });

  describe('POST /api/paddle/webhook - Adjustment Updated (Refunds)', () => {
    let refundPayload: any;
    let timestamp: string;
    let signature: string;

    beforeEach(() => {
      timestamp = Math.floor(Date.now() / 1000).toString();
      refundPayload = {
        event_type: 'adjustment.updated',
        data: {
          id: 'adj_12345',
          transaction_id: 'txn_12345',
          status: 'approved',
          action: 'refund',
        },
      };
      signature = createValidSignature(refundPayload, timestamp);
    });

    it('should revoke license on approved refund', async () => {
      prismaMock.webhookEvent.upsert.mockResolvedValue({} as any);
      prismaMock.webhookEvent.update.mockResolvedValue({} as any);

      prismaMock.$transaction.mockImplementation(async (callback: any) => {
        return callback(prismaMock);
      });

      // Mock existing purchase
      prismaMock.paddlePurchase.findUnique.mockResolvedValue({
        id: 'purchase-1',
        paddleTransactionId: 'txn_12345',
        paddleCustomerId: 'ctm_12345',
        email: 'customer@example.com',
        licenseId: 'license-1',
        userId: 'user-1',
        emailSent: true,
        emailSentAt: new Date(),
        paddleData: {},
        createdAt: new Date(),
        updatedAt: new Date(),
        license: {
          id: 'license-1',
          licenseKey: 'TEST-1234-5678-9012',
          status: 'ACTIVE',
        } as any,
        user: {
          id: 'user-1',
          email: 'customer@example.com',
        } as any,
      } as any);

      prismaMock.license.update.mockResolvedValue({} as any);

      const response = await app.inject({
        method: 'POST',
        url: '/api/paddle/webhook',
        headers: {
          'content-type': 'application/json',
          'paddle-signature': signature,
        },
        payload: refundPayload,
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);

      // Verify license was revoked
      expect(prismaMock.license.update).toHaveBeenCalledWith({
        where: { id: 'license-1' },
        data: expect.objectContaining({
          status: 'REVOKED',
          revokedAt: expect.any(Date),
        }),
      });
    });

    it('should skip if license already revoked', async () => {
      prismaMock.webhookEvent.upsert.mockResolvedValue({} as any);
      prismaMock.webhookEvent.update.mockResolvedValue({} as any);

      prismaMock.$transaction.mockImplementation(async (callback: any) => {
        return callback(prismaMock);
      });

      prismaMock.paddlePurchase.findUnique.mockResolvedValue({
        id: 'purchase-1',
        license: {
          id: 'license-1',
          status: 'REVOKED', // Already revoked
        } as any,
        user: {} as any,
      } as any);

      const response = await app.inject({
        method: 'POST',
        url: '/api/paddle/webhook',
        headers: {
          'content-type': 'application/json',
          'paddle-signature': signature,
        },
        payload: refundPayload,
      });

      expect(response.statusCode).toBe(200);

      // Should not update license
      expect(prismaMock.license.update).not.toHaveBeenCalled();
    });

    it('should skip non-refund adjustments', async () => {
      const creditPayload = {
        ...refundPayload,
        data: { ...refundPayload.data, action: 'credit' },
      };
      const creditSignature = createValidSignature(creditPayload, timestamp);

      prismaMock.webhookEvent.upsert.mockResolvedValue({} as any);
      prismaMock.webhookEvent.update.mockResolvedValue({} as any);

      const response = await app.inject({
        method: 'POST',
        url: '/api/paddle/webhook',
        headers: {
          'content-type': 'application/json',
          'paddle-signature': creditSignature,
        },
        payload: creditPayload,
      });

      expect(response.statusCode).toBe(200);

      // Should not revoke license for credits
      expect(prismaMock.license.update).not.toHaveBeenCalled();
    });
  });
});
