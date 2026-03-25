import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { prismaMock } from './setup';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../index';

describe('License Routes', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    vi.clearAllMocks();
    // Ensure required env vars are set so buildApp() config validation passes
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

  describe('POST /api/licenses/trial', () => {
    const fingerprint = 'test-device-fingerprint-abc123';
    const deviceName = 'Test MacBook';

    const makeMockLicense = (overrides: object = {}) => ({
      id: 'license-trial-1',
      userId: 'user-trial-1',
      licenseKey: 'ABCD-EFGH-IJKL-MNOP',
      status: 'ACTIVE' as const,
      issuedAt: new Date(),
      expiresAt: new Date(Date.now() + 3 * 86_400_000),
      activatedAt: new Date(),
      revokedAt: null,
      maxActivations: 1,
      isTrial: true,
      currentActivations: 0,
      metadata: null,
      notes: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      ...overrides,
    });

    it('should return 200 with licenseKey, expiresAt and isTrial=true for a new trial', async () => {
      prismaMock.deviceActivation.findFirst.mockResolvedValue(null);

      const mockLicense = makeMockLicense();
      prismaMock.$transaction.mockImplementation(async (fn: any) => {
        prismaMock.user.upsert.mockResolvedValue({ id: 'user-trial-1' } as any);
        prismaMock.license.create.mockResolvedValue(mockLicense as any);
        prismaMock.deviceActivation.create.mockResolvedValue({} as any);
        return fn(prismaMock);
      });

      const response = await app.inject({
        method: 'POST',
        url: '/api/licenses/trial',
        headers: { 'content-type': 'application/json' },
        payload: { deviceFingerprint: fingerprint, deviceName },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.isTrial).toBe(true);
      expect(body.licenseKey).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/);
      expect(typeof body.expiresAt).toBe('string');
      expect(new Date(body.expiresAt).getTime()).toBeGreaterThan(Date.now());
    });

    it('should return 200 with the existing trial key for a duplicate fingerprint', async () => {
      const existingLicense = makeMockLicense({ licenseKey: 'EXST-TRIA-LKEY-0001' });
      prismaMock.deviceActivation.findFirst.mockResolvedValue({
        id: 'activation-1',
        licenseId: existingLicense.id,
        deviceFingerprint: fingerprint,
        deviceName,
        license: existingLicense,
      } as any);

      const response = await app.inject({
        method: 'POST',
        url: '/api/licenses/trial',
        headers: { 'content-type': 'application/json' },
        payload: { deviceFingerprint: fingerprint, deviceName },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.isTrial).toBe(true);
      expect(body.licenseKey).toBe('EXST-TRIA-LKEY-0001');
    });

    it('should return 409 when the device already has a paid license', async () => {
      const paidLicense = makeMockLicense({ isTrial: false, licenseKey: 'PAID-LICS-ENKY-0001' });
      prismaMock.deviceActivation.findFirst.mockResolvedValue({
        id: 'activation-1',
        licenseId: paidLicense.id,
        deviceFingerprint: fingerprint,
        deviceName,
        license: paidLicense,
      } as any);

      const response = await app.inject({
        method: 'POST',
        url: '/api/licenses/trial',
        headers: { 'content-type': 'application/json' },
        payload: { deviceFingerprint: fingerprint },
      });

      expect(response.statusCode).toBe(409);
      const body = JSON.parse(response.body);
      expect(body.error).toBe('paid_license_exists');
      expect(typeof body.message).toBe('string');
    });

    it('should return 400 when deviceFingerprint is missing', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/licenses/trial',
        headers: { 'content-type': 'application/json' },
        payload: { deviceName },
      });

      expect(response.statusCode).toBe(400);
    });

    it('should return 400 when deviceFingerprint is an empty string', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/licenses/trial',
        headers: { 'content-type': 'application/json' },
        payload: { deviceFingerprint: '' },
      });

      expect(response.statusCode).toBe(400);
    });

    it('should default TRIAL_DURATION_DAYS to 3 when env var is not set', async () => {
      delete process.env.TRIAL_DURATION_DAYS;

      prismaMock.deviceActivation.findFirst.mockResolvedValue(null);

      const mockLicense = makeMockLicense();
      prismaMock.$transaction.mockImplementation(async (fn: any) => {
        prismaMock.user.upsert.mockResolvedValue({ id: 'user-trial-1' } as any);
        prismaMock.license.create.mockResolvedValue(mockLicense as any);
        prismaMock.deviceActivation.create.mockResolvedValue({} as any);
        return fn(prismaMock);
      });

      const before = Date.now();
      const response = await app.inject({
        method: 'POST',
        url: '/api/licenses/trial',
        headers: { 'content-type': 'application/json' },
        payload: { deviceFingerprint: fingerprint },
      });
      const after = Date.now();

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      const expiresMs = new Date(body.expiresAt).getTime();
      // Should be approximately now + 3 days
      expect(expiresMs).toBeGreaterThanOrEqual(before + 3 * 86_400_000 - 2000);
      expect(expiresMs).toBeLessThanOrEqual(after + 3 * 86_400_000 + 2000);
    });
  });
});
