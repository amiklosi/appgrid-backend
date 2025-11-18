import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { prismaMock } from './setup';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../index';
import * as emailLib from '../lib/email';

// Mock the email service
vi.mock('../lib/email', () => ({
  emailService: {
    sendMigrationLicenseEmail: vi.fn(),
  },
}));

// Mock fetch globally
global.fetch = vi.fn();

describe('RevenueCat Migration Routes', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    vi.clearAllMocks();
    app = await buildApp();
    await app.ready();
  });

  afterEach(async () => {
    if (app) {
      await app.close();
    }
  });

  const mockRevenueCatResponse = (entitlements: any[]) => ({
    active_entitlements: {
      items: entitlements,
    },
  });

  describe('POST /api/revenuecat/migrate', () => {
    const validRequest = {
      email: 'test@example.com',
      userId: '$RCAnonymousID:test123',
    };

    beforeEach(() => {
      process.env.REVENUECAT_API_KEY = 'test-api-key';
      process.env.REVENUECAT_PROJECT_ID = 'test-project-id';
      process.env.MAILGUN_API_KEY = 'test-mailgun-key';
      process.env.MAILGUN_DOMAIN = 'test.mailgun.org';
    });

    it('should successfully migrate a user with lifetime purchase', async () => {
      // Mock: Check for existing migration (not found)
      prismaMock.revenueCatMigration.findUnique.mockResolvedValue(null);

      // Mock: RevenueCat API returns lifetime entitlement
      (global.fetch as any).mockResolvedValue({
        ok: true,
        json: async () =>
          mockRevenueCatResponse([
            {
              expires_at: null, // Lifetime
            },
          ]),
      });

      // Mock: Find or create user
      prismaMock.user.findUnique.mockResolvedValue(null);
      prismaMock.user.create.mockResolvedValue({
        id: 'user-123',
        email: validRequest.email,
        name: null,
        company: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      // Mock: Create license (via LicenseService)
      const mockLicense = {
        id: 'license-123',
        userId: 'user-123',
        licenseKey: 'TEST-LICE-NSE1-KEY1',
        status: 'ACTIVE' as const,
        issuedAt: new Date(),
        expiresAt: null,
        activatedAt: null,
        revokedAt: null,
        maxActivations: 5,
        currentActivations: 0,
        metadata: { source: 'revenuecat_migration' },
        notes: 'Migrated from RevenueCat',
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      prismaMock.license.create.mockResolvedValue(mockLicense);

      // Mock: Email service
      vi.mocked(emailLib.emailService.sendMigrationLicenseEmail).mockResolvedValue({
        success: true,
        messageId: 'test-message-id',
      });

      // Mock: Create migration record
      prismaMock.revenueCatMigration.create.mockResolvedValue({
        id: 'migration-123',
        revenueCatUserId: validRequest.userId,
        email: validRequest.email,
        licenseId: mockLicense.id,
        userId: 'user-123',
        emailSent: true,
        emailSentAt: new Date(),
        revenueCatData: {},
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const response = await app.inject({
        method: 'POST',
        url: '/api/revenuecat/migrate',
        payload: validRequest,
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
      expect(body.alreadyMigrated).toBe(false);
      expect(body.subscriptionType).toBe('lifetime');
      expect(body.licenseKey).toBe(mockLicense.licenseKey);
      expect(body.expiresAt).toBe(null);
      expect(body.emailSent).toBe(true);
    });

    it('should successfully migrate a user with annual subscription', async () => {
      // Mock: Check for existing migration (not found)
      prismaMock.revenueCatMigration.findUnique.mockResolvedValue(null);

      // Mock: RevenueCat API returns annual subscription (expires in 1 year)
      const oneYearFromNow = new Date();
      oneYearFromNow.setFullYear(oneYearFromNow.getFullYear() + 1);

      (global.fetch as any).mockResolvedValue({
        ok: true,
        json: async () =>
          mockRevenueCatResponse([
            {
              expires_at: oneYearFromNow.toISOString(),
            },
          ]),
      });

      // Mock: Find existing user
      prismaMock.user.findUnique.mockResolvedValue({
        id: 'user-123',
        email: validRequest.email,
        name: 'Test User',
        company: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      // Mock: Create license
      const mockLicense = {
        id: 'license-123',
        userId: 'user-123',
        licenseKey: 'TEST-ANNU-AL12-KEY1',
        status: 'ACTIVE' as const,
        issuedAt: new Date(),
        expiresAt: oneYearFromNow,
        activatedAt: null,
        revokedAt: null,
        maxActivations: 5,
        currentActivations: 0,
        metadata: { source: 'revenuecat_migration' },
        notes: 'Migrated from RevenueCat',
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      prismaMock.license.create.mockResolvedValue(mockLicense);

      // Mock: Email service
      vi.mocked(emailLib.emailService.sendMigrationLicenseEmail).mockResolvedValue({
        success: true,
        messageId: 'test-message-id',
      });

      // Mock: Create migration record
      prismaMock.revenueCatMigration.create.mockResolvedValue({
        id: 'migration-123',
        revenueCatUserId: validRequest.userId,
        email: validRequest.email,
        licenseId: mockLicense.id,
        userId: 'user-123',
        emailSent: true,
        emailSentAt: new Date(),
        revenueCatData: {},
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const response = await app.inject({
        method: 'POST',
        url: '/api/revenuecat/migrate',
        payload: validRequest,
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
      expect(body.alreadyMigrated).toBe(false);
      expect(body.subscriptionType).toBe('annual');
      expect(body.expiresAt).not.toBe(null);
    });

    it('should return existing migration for already migrated user', async () => {
      const existingLicense = {
        id: 'license-123',
        userId: 'user-123',
        licenseKey: 'EXIS-TING-LICE-NSE1',
        status: 'ACTIVE' as const,
        issuedAt: new Date(),
        expiresAt: null,
        activatedAt: null,
        revokedAt: null,
        maxActivations: 5,
        currentActivations: 0,
        metadata: null,
        notes: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      // Mock: Check for existing migration (found)
      prismaMock.revenueCatMigration.findUnique.mockResolvedValue({
        id: 'migration-123',
        revenueCatUserId: validRequest.userId,
        email: validRequest.email,
        licenseId: existingLicense.id,
        userId: 'user-123',
        emailSent: true,
        emailSentAt: new Date(),
        revenueCatData: {},
        createdAt: new Date(),
        updatedAt: new Date(),
        license: existingLicense,
        user: {
          id: 'user-123',
          email: validRequest.email,
          name: 'Test User',
          company: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      } as any);

      const response = await app.inject({
        method: 'POST',
        url: '/api/revenuecat/migrate',
        payload: validRequest,
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
      expect(body.alreadyMigrated).toBe(true);
      expect(body.licenseKey).toBe(existingLicense.licenseKey);

      // Should not create new license or migration
      expect(prismaMock.license.create).not.toHaveBeenCalled();
      expect(prismaMock.revenueCatMigration.create).not.toHaveBeenCalled();
    });

    it('should reject migration when no eligible purchase found', async () => {
      // Mock: Check for existing migration (not found)
      prismaMock.revenueCatMigration.findUnique.mockResolvedValue(null);

      // Mock: RevenueCat API returns monthly subscription (expires in 1 month)
      const oneMonthFromNow = new Date();
      oneMonthFromNow.setMonth(oneMonthFromNow.getMonth() + 1);

      (global.fetch as any).mockResolvedValue({
        ok: true,
        json: async () =>
          mockRevenueCatResponse([
            {
              expires_at: oneMonthFromNow.toISOString(), // Only 1 month, not eligible
            },
          ]),
      });

      const response = await app.inject({
        method: 'POST',
        url: '/api/revenuecat/migrate',
        payload: validRequest,
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(false);
      expect(body.error).toContain('No eligible purchase found');

      // Should not create license
      expect(prismaMock.license.create).not.toHaveBeenCalled();
    });

    it('should reject migration when no active entitlements', async () => {
      // Mock: Check for existing migration (not found)
      prismaMock.revenueCatMigration.findUnique.mockResolvedValue(null);

      // Mock: RevenueCat API returns no entitlements
      (global.fetch as any).mockResolvedValue({
        ok: true,
        json: async () => mockRevenueCatResponse([]),
      });

      const response = await app.inject({
        method: 'POST',
        url: '/api/revenuecat/migrate',
        payload: validRequest,
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(false);
      expect(body.error).toContain('No eligible purchase found');
    });

    it('should handle RevenueCat API error', async () => {
      // Mock: Check for existing migration (not found)
      prismaMock.revenueCatMigration.findUnique.mockResolvedValue(null);

      // Mock: RevenueCat API returns error
      (global.fetch as any).mockResolvedValue({
        ok: false,
        status: 404,
        statusText: 'Not Found',
        text: async () => 'Customer not found',
      });

      const response = await app.inject({
        method: 'POST',
        url: '/api/revenuecat/migrate',
        payload: validRequest,
      });

      expect(response.statusCode).toBe(500);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(false);
      expect(body.error).toContain('RevenueCat API error');
    });

    it('should return error when RevenueCat configuration is missing', async () => {
      delete process.env.REVENUECAT_API_KEY;

      const response = await app.inject({
        method: 'POST',
        url: '/api/revenuecat/migrate',
        payload: validRequest,
      });

      expect(response.statusCode).toBe(500);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(false);
      expect(body.error).toBe('RevenueCat configuration missing');

      // Restore for other tests
      process.env.REVENUECAT_API_KEY = 'test-api-key';
    });

    it('should handle email sending failure gracefully', async () => {
      // Mock: Check for existing migration (not found)
      prismaMock.revenueCatMigration.findUnique.mockResolvedValue(null);

      // Mock: RevenueCat API returns lifetime entitlement
      (global.fetch as any).mockResolvedValue({
        ok: true,
        json: async () =>
          mockRevenueCatResponse([
            {
              expires_at: null,
            },
          ]),
      });

      // Mock: User creation
      prismaMock.user.findUnique.mockResolvedValue(null);
      prismaMock.user.create.mockResolvedValue({
        id: 'user-123',
        email: validRequest.email,
        name: null,
        company: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      // Mock: License creation
      const mockLicense = {
        id: 'license-123',
        userId: 'user-123',
        licenseKey: 'TEST-LICE-NSE1-KEY1',
        status: 'ACTIVE' as const,
        issuedAt: new Date(),
        expiresAt: null,
        activatedAt: null,
        revokedAt: null,
        maxActivations: 5,
        currentActivations: 0,
        metadata: { source: 'revenuecat_migration' },
        notes: 'Migrated from RevenueCat',
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      prismaMock.license.create.mockResolvedValue(mockLicense);

      // Mock: Email service fails
      vi.mocked(emailLib.emailService.sendMigrationLicenseEmail).mockResolvedValue({
        success: false,
        error: 'Mailgun error',
      });

      // Mock: Create migration record
      prismaMock.revenueCatMigration.create.mockResolvedValue({
        id: 'migration-123',
        revenueCatUserId: validRequest.userId,
        email: validRequest.email,
        licenseId: mockLicense.id,
        userId: 'user-123',
        emailSent: false,
        emailSentAt: null,
        revenueCatData: {},
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const response = await app.inject({
        method: 'POST',
        url: '/api/revenuecat/migrate',
        payload: validRequest,
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
      expect(body.emailSent).toBe(false); // Email failed but migration succeeded
      expect(body.licenseKey).toBe(mockLicense.licenseKey);
    });

    it('should validate request body', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/revenuecat/migrate',
        payload: {
          // Missing required fields
        },
      });

      expect(response.statusCode).toBe(400);
    });

    it('should validate email format', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/revenuecat/migrate',
        payload: {
          email: 'invalid-email',
          userId: '$RCAnonymousID:test123',
        },
      });

      expect(response.statusCode).toBe(400);
    });

    it('should call RevenueCat API with correct parameters', async () => {
      // Mock: Check for existing migration (not found)
      prismaMock.revenueCatMigration.findUnique.mockResolvedValue(null);

      // Mock: RevenueCat API
      (global.fetch as any).mockResolvedValue({
        ok: true,
        json: async () => mockRevenueCatResponse([{ expires_at: null }]),
      });

      // Mock other required calls
      prismaMock.user.findUnique.mockResolvedValue({
        id: 'user-123',
        email: validRequest.email,
        name: null,
        company: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      prismaMock.license.create.mockResolvedValue({
        id: 'license-123',
        userId: 'user-123',
        licenseKey: 'TEST-KEY1-KEY2-KEY3',
        status: 'ACTIVE' as const,
        issuedAt: new Date(),
        expiresAt: null,
        activatedAt: null,
        revokedAt: null,
        maxActivations: 5,
        currentActivations: 0,
        metadata: null,
        notes: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      vi.mocked(emailLib.emailService.sendMigrationLicenseEmail).mockResolvedValue({
        success: true,
        messageId: 'test-id',
      });
      prismaMock.revenueCatMigration.create.mockResolvedValue({
        id: 'migration-123',
        revenueCatUserId: validRequest.userId,
        email: validRequest.email,
        licenseId: 'license-123',
        userId: 'user-123',
        emailSent: true,
        emailSentAt: new Date(),
        revenueCatData: {},
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      await app.inject({
        method: 'POST',
        url: '/api/revenuecat/migrate',
        payload: validRequest,
      });

      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining(`/customers/${encodeURIComponent(validRequest.userId)}`),
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer test-api-key',
            'Content-Type': 'application/json',
          }),
        })
      );
    });
  });
});
