import { describe, it, expect, beforeEach } from 'vitest';
import { LicenseService } from '../services/license.service';
import { prismaMock } from './setup';

describe('LicenseService', () => {
  beforeEach(() => {
    // Reset is handled by setup.ts
  });

  describe('generateLicenseKey', () => {
    it('should generate a license key in format XXXX-XXXX-XXXX-XXXX', () => {
      const key = LicenseService.generateLicenseKey();

      expect(key).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/);
    });

    it('should generate unique keys', () => {
      const keys = new Set();
      for (let i = 0; i < 100; i++) {
        keys.add(LicenseService.generateLicenseKey());
      }

      expect(keys.size).toBe(100);
    });
  });

  describe('createLicense', () => {
    it('should create a license with required fields', async () => {
      const userId = 'user-123';
      const mockLicense = {
        id: 'license-123',
        userId,
        licenseKey: 'ABCD-EFGH-IJKL-MNOP',
        status: 'ACTIVE' as const,
        issuedAt: new Date(),
        expiresAt: null,
        activatedAt: null,
        revokedAt: null,
        maxActivations: 1,
        currentActivations: 0,
        metadata: null,
        notes: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        user: {
          id: userId,
          email: 'test@example.com',
          name: 'Test User',
        },
      };

      prismaMock.license.create.mockResolvedValue(mockLicense);

      const result = await LicenseService.createLicense({ userId });

      expect(result).toEqual(mockLicense);
      expect(prismaMock.license.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            userId,
            maxActivations: 1,
          }),
        })
      );
    });

    it('should create a license with custom expiry and activations', async () => {
      const userId = 'user-123';
      const expiresAt = new Date('2026-12-31').toISOString();
      const mockLicense = {
        id: 'license-123',
        userId,
        licenseKey: 'ABCD-EFGH-IJKL-MNOP',
        status: 'ACTIVE' as const,
        issuedAt: new Date(),
        expiresAt: new Date(expiresAt),
        activatedAt: null,
        revokedAt: null,
        maxActivations: 5,
        currentActivations: 0,
        metadata: null,
        notes: 'Test license',
        createdAt: new Date(),
        updatedAt: new Date(),
        user: {
          id: userId,
          email: 'test@example.com',
          name: 'Test User',
        },
      };

      prismaMock.license.create.mockResolvedValue(mockLicense);

      const result = await LicenseService.createLicense({
        userId,
        maxActivations: 5,
        expiresAt,
        notes: 'Test license',
      });

      expect(result.maxActivations).toBe(5);
      expect(result.expiresAt).toEqual(new Date(expiresAt));
    });
  });

  describe('validateLicense', () => {
    it('should validate a valid active license', async () => {
      const licenseKey = 'ABCD-EFGH-IJKL-MNOP';
      const mockLicense = {
        id: 'license-123',
        userId: 'user-123',
        licenseKey,
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
        user: {
          id: 'user-123',
          email: 'test@example.com',
          name: 'Test User',
        },
      };

      prismaMock.license.findUnique.mockResolvedValue(mockLicense);
      prismaMock.license.update.mockResolvedValue({
        ...mockLicense,
        currentActivations: 1,
        activatedAt: new Date(),
      });
      prismaMock.licenseValidation.create.mockResolvedValue({} as any);

      const result = await LicenseService.validateLicense(licenseKey);

      expect(result.valid).toBe(true);
      expect(result.message).toBe('License is valid');
      expect(result.license).toEqual(mockLicense);
      expect(prismaMock.license.update).toHaveBeenCalled();
    });

    it('should reject non-existent license key', async () => {
      prismaMock.license.findUnique.mockResolvedValue(null);
      prismaMock.licenseValidation.create.mockRejectedValue(new Error('License not found'));

      const result = await LicenseService.validateLicense('FAKE-KEY-1234');

      expect(result.valid).toBe(false);
      expect(result.message).toBe('License key not found');
      expect(result.license).toBeNull();
    });

    it('should reject revoked license', async () => {
      const mockLicense = {
        id: 'license-123',
        userId: 'user-123',
        licenseKey: 'ABCD-EFGH-IJKL-MNOP',
        status: 'REVOKED' as const,
        issuedAt: new Date(),
        expiresAt: null,
        activatedAt: new Date(),
        revokedAt: new Date(),
        maxActivations: 1,
        currentActivations: 1,
        metadata: null,
        notes: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        user: {
          id: 'user-123',
          email: 'test@example.com',
          name: 'Test User',
        },
      };

      prismaMock.license.findUnique.mockResolvedValue(mockLicense);
      prismaMock.licenseValidation.create.mockResolvedValue({} as any);

      const result = await LicenseService.validateLicense('ABCD-EFGH-IJKL-MNOP');

      expect(result.valid).toBe(false);
      expect(result.message).toBe('License has been revoked');
    });

    it('should reject expired license', async () => {
      const mockLicense = {
        id: 'license-123',
        userId: 'user-123',
        licenseKey: 'ABCD-EFGH-IJKL-MNOP',
        status: 'ACTIVE' as const,
        issuedAt: new Date(),
        expiresAt: new Date('2020-01-01'), // Expired
        activatedAt: null,
        revokedAt: null,
        maxActivations: 1,
        currentActivations: 0,
        metadata: null,
        notes: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        user: {
          id: 'user-123',
          email: 'test@example.com',
          name: 'Test User',
        },
      };

      prismaMock.license.findUnique.mockResolvedValue(mockLicense);
      prismaMock.license.update.mockResolvedValue({
        ...mockLicense,
        status: 'EXPIRED' as const,
      });
      prismaMock.licenseValidation.create.mockResolvedValue({} as any);

      const result = await LicenseService.validateLicense('ABCD-EFGH-IJKL-MNOP');

      expect(result.valid).toBe(false);
      expect(result.message).toBe('License has expired');
      expect(prismaMock.license.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { status: 'EXPIRED' },
        })
      );
    });

    it('should reject license with max activations reached', async () => {
      const mockLicense = {
        id: 'license-123',
        userId: 'user-123',
        licenseKey: 'ABCD-EFGH-IJKL-MNOP',
        status: 'ACTIVE' as const,
        issuedAt: new Date(),
        expiresAt: null,
        activatedAt: new Date(),
        revokedAt: null,
        maxActivations: 1,
        currentActivations: 1, // Already at max
        metadata: null,
        notes: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        user: {
          id: 'user-123',
          email: 'test@example.com',
          name: 'Test User',
        },
      };

      prismaMock.license.findUnique.mockResolvedValue(mockLicense);
      prismaMock.licenseValidation.create.mockResolvedValue({} as any);

      const result = await LicenseService.validateLicense('ABCD-EFGH-IJKL-MNOP');

      expect(result.valid).toBe(false);
      expect(result.message).toBe('Maximum activations reached');
    });
  });

  describe('deactivateLicense', () => {
    it('should deactivate a license successfully', async () => {
      const licenseKey = 'ABCD-EFGH-IJKL-MNOP';
      const mockLicense = {
        id: 'license-123',
        userId: 'user-123',
        licenseKey,
        status: 'ACTIVE' as const,
        issuedAt: new Date(),
        expiresAt: null,
        activatedAt: new Date(),
        revokedAt: null,
        maxActivations: 5,
        currentActivations: 3,
        metadata: null,
        notes: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        user: {
          id: 'user-123',
          email: 'test@example.com',
          name: 'Test User',
        },
      };

      prismaMock.license.findUnique.mockResolvedValue(mockLicense);
      prismaMock.license.update.mockResolvedValue({
        ...mockLicense,
        currentActivations: 2,
      });
      prismaMock.licenseValidation.create.mockResolvedValue({} as any);

      const result = await LicenseService.deactivateLicense(licenseKey, 'device-fp-123');

      expect(result.success).toBe(true);
      expect(result.message).toBe('License deactivated successfully');
      expect(result.currentActivations).toBe(2);
      expect(prismaMock.license.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { currentActivations: { decrement: 1 } },
        })
      );
    });

    it('should reject deactivation when no activations exist', async () => {
      const mockLicense = {
        id: 'license-123',
        userId: 'user-123',
        licenseKey: 'ABCD-EFGH-IJKL-MNOP',
        status: 'ACTIVE' as const,
        issuedAt: new Date(),
        expiresAt: null,
        activatedAt: null,
        revokedAt: null,
        maxActivations: 1,
        currentActivations: 0,
        metadata: null,
        notes: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        user: {
          id: 'user-123',
          email: 'test@example.com',
          name: 'Test User',
        },
      };

      prismaMock.license.findUnique.mockResolvedValue(mockLicense);
      prismaMock.licenseValidation.create.mockResolvedValue({} as any);

      const result = await LicenseService.deactivateLicense('ABCD-EFGH-IJKL-MNOP', 'device-fp-123');

      expect(result.success).toBe(false);
      expect(result.message).toBe('No active activations to deactivate');
      expect(prismaMock.license.update).not.toHaveBeenCalled();
    });

    it('should reject deactivation for non-existent license', async () => {
      prismaMock.license.findUnique.mockResolvedValue(null);
      prismaMock.licenseValidation.create.mockRejectedValue(new Error('License not found'));

      const result = await LicenseService.deactivateLicense('FAKE-KEY-1234', 'device-fp-123');

      expect(result.success).toBe(false);
      expect(result.message).toBe('License key not found');
    });

    it('should log deactivation attempt', async () => {
      const mockLicense = {
        id: 'license-123',
        userId: 'user-123',
        licenseKey: 'ABCD-EFGH-IJKL-MNOP',
        status: 'ACTIVE' as const,
        issuedAt: new Date(),
        expiresAt: null,
        activatedAt: new Date(),
        revokedAt: null,
        maxActivations: 5,
        currentActivations: 2,
        metadata: null,
        notes: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        user: {
          id: 'user-123',
          email: 'test@example.com',
          name: 'Test User',
        },
      };

      prismaMock.license.findUnique.mockResolvedValue(mockLicense);
      prismaMock.license.update.mockResolvedValue({
        ...mockLicense,
        currentActivations: 1,
      });
      prismaMock.licenseValidation.create.mockResolvedValue({} as any);

      await LicenseService.deactivateLicense(
        'ABCD-EFGH-IJKL-MNOP',
        'device-123',
        '192.168.1.1',
        'TestAgent'
      );

      expect(prismaMock.licenseValidation.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            licenseId: 'license-123',
            isValid: true,
            validationMessage: 'Deactivation: License deactivated successfully',
            ipAddress: '192.168.1.1',
            userAgent: 'TestAgent',
            deviceFingerprint: 'device-123',
          }),
        })
      );
    });
  });

  describe('getLicenseByKey', () => {
    it('should return license with user and validations', async () => {
      const mockLicense = {
        id: 'license-123',
        userId: 'user-123',
        licenseKey: 'ABCD-EFGH-IJKL-MNOP',
        status: 'ACTIVE' as const,
        issuedAt: new Date(),
        expiresAt: null,
        activatedAt: null,
        revokedAt: null,
        maxActivations: 1,
        currentActivations: 0,
        metadata: null,
        notes: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        user: {
          id: 'user-123',
          email: 'test@example.com',
          name: 'Test User',
          company: 'Test Co',
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        validations: [],
      };

      prismaMock.license.findUnique.mockResolvedValue(mockLicense);

      const result = await LicenseService.getLicenseByKey('ABCD-EFGH-IJKL-MNOP');

      expect(result).toEqual(mockLicense);
      expect(prismaMock.license.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { licenseKey: 'ABCD-EFGH-IJKL-MNOP' },
          include: expect.objectContaining({
            user: true,
            validations: expect.any(Object),
          }),
        })
      );
    });
  });

  describe('updateLicense', () => {
    it('should update license status', async () => {
      const mockLicense = {
        id: 'license-123',
        userId: 'user-123',
        licenseKey: 'ABCD-EFGH-IJKL-MNOP',
        status: 'SUSPENDED' as const,
        issuedAt: new Date(),
        expiresAt: null,
        activatedAt: null,
        revokedAt: null,
        maxActivations: 1,
        currentActivations: 0,
        metadata: null,
        notes: 'Suspended for testing',
        createdAt: new Date(),
        updatedAt: new Date(),
        user: {
          id: 'user-123',
          email: 'test@example.com',
          name: 'Test User',
        },
      };

      prismaMock.license.update.mockResolvedValue(mockLicense);

      const result = await LicenseService.updateLicense('license-123', {
        status: 'SUSPENDED',
        notes: 'Suspended for testing',
      });

      expect(result.status).toBe('SUSPENDED');
      expect(result.notes).toBe('Suspended for testing');
    });
  });

  describe('revokeLicense', () => {
    it('should revoke license with reason', async () => {
      const now = new Date();
      const mockLicense = {
        id: 'license-123',
        userId: 'user-123',
        licenseKey: 'ABCD-EFGH-IJKL-MNOP',
        status: 'REVOKED' as const,
        issuedAt: new Date(),
        expiresAt: null,
        activatedAt: null,
        revokedAt: now,
        maxActivations: 1,
        currentActivations: 0,
        metadata: null,
        notes: 'Policy violation',
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      prismaMock.license.update.mockResolvedValue(mockLicense);

      const result = await LicenseService.revokeLicense('license-123', 'Policy violation');

      expect(result.status).toBe('REVOKED');
      expect(result.revokedAt).toEqual(now);
      expect(result.notes).toBe('Policy violation');
      expect(prismaMock.license.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: 'REVOKED',
            notes: 'Policy violation',
          }),
        })
      );
    });
  });

  describe('deleteLicense', () => {
    it('should delete a license', async () => {
      const mockLicense = {
        id: 'license-123',
        userId: 'user-123',
        licenseKey: 'ABCD-EFGH-IJKL-MNOP',
        status: 'ACTIVE' as const,
        issuedAt: new Date(),
        expiresAt: null,
        activatedAt: null,
        revokedAt: null,
        maxActivations: 1,
        currentActivations: 0,
        metadata: null,
        notes: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      prismaMock.license.delete.mockResolvedValue(mockLicense);

      const result = await LicenseService.deleteLicense('license-123');

      expect(result).toEqual(mockLicense);
      expect(prismaMock.license.delete).toHaveBeenCalledWith({
        where: { id: 'license-123' },
      });
    });
  });

  describe('listLicenses', () => {
    it('should list all licenses with pagination', async () => {
      const mockLicenses = [
        {
          id: 'license-1',
          userId: 'user-123',
          licenseKey: 'AAAA-BBBB-CCCC-DDDD',
          status: 'ACTIVE' as const,
          issuedAt: new Date(),
          expiresAt: null,
          activatedAt: null,
          revokedAt: null,
          maxActivations: 1,
          currentActivations: 0,
          metadata: null,
          notes: null,
          createdAt: new Date(),
          updatedAt: new Date(),
          user: {
            id: 'user-123',
            email: 'test@example.com',
            name: 'Test User',
          },
        },
      ];

      prismaMock.license.findMany.mockResolvedValue(mockLicenses);
      prismaMock.license.count.mockResolvedValue(1);

      const result = await LicenseService.listLicenses();

      expect(result.licenses).toEqual(mockLicenses);
      expect(result.total).toBe(1);
    });

    it('should filter licenses by userId', async () => {
      const userId = 'user-123';
      prismaMock.license.findMany.mockResolvedValue([]);
      prismaMock.license.count.mockResolvedValue(0);

      await LicenseService.listLicenses({ userId });

      expect(prismaMock.license.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId },
        })
      );
    });

    it('should filter licenses by status', async () => {
      prismaMock.license.findMany.mockResolvedValue([]);
      prismaMock.license.count.mockResolvedValue(0);

      await LicenseService.listLicenses({ status: 'EXPIRED' });

      expect(prismaMock.license.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { status: 'EXPIRED' },
        })
      );
    });
  });
});
