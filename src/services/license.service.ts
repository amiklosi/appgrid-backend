import { randomBytes } from 'crypto';
import { prisma } from '../lib/prisma';
import type { CreateLicenseDTO, UpdateLicenseDTO } from '../schemas/license.schema';

export class LicenseService {
  /**
   * Generate a random license key in the format: XXXX-XXXX-XXXX-XXXX
   */
  static generateLicenseKey(): string {
    const segments = 4;
    const segmentLength = 4;
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

    const parts: string[] = [];
    for (let i = 0; i < segments; i++) {
      let segment = '';
      const bytes = randomBytes(segmentLength);
      for (let j = 0; j < segmentLength; j++) {
        segment += chars[bytes[j] % chars.length];
      }
      parts.push(segment);
    }

    return parts.join('-');
  }

  /**
   * Create a new license
   */
  static async createLicense(data: CreateLicenseDTO) {
    const licenseKey = this.generateLicenseKey();

    const license = await prisma.license.create({
      data: {
        userId: data.userId,
        licenseKey,
        expiresAt: data.expiresAt ? new Date(data.expiresAt) : null,
        maxActivations: data.maxActivations || 1,
        metadata: data.metadata ? (data.metadata as any) : null,
        notes: data.notes,
      },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            name: true,
          },
        },
      },
    });

    return license;
  }

  /**
   * Validate a license key
   */
  static async validateLicense(
    licenseKey: string,
    deviceFingerprint?: string,
    ipAddress?: string,
    userAgent?: string
  ) {
    const license = await prisma.license.findUnique({
      where: { licenseKey },
      include: {
        user: true,
      },
    });

    let isValid = false;
    let message = '';

    if (!license) {
      message = 'License key not found';
    } else if (license.status === 'REVOKED') {
      message = 'License has been revoked';
    } else if (license.status === 'SUSPENDED') {
      message = 'License is suspended';
    } else if (license.expiresAt && new Date(license.expiresAt) < new Date()) {
      message = 'License has expired';
      // Auto-update status
      await prisma.license.update({
        where: { id: license.id },
        data: { status: 'EXPIRED' },
      });
    } else if (license.currentActivations >= license.maxActivations) {
      message = 'Maximum activations reached';
    } else {
      isValid = true;
      message = 'License is valid';

      // Increment activation count on first use
      if (license.currentActivations === 0) {
        await prisma.license.update({
          where: { id: license.id },
          data: {
            currentActivations: { increment: 1 },
            activatedAt: new Date(),
          },
        });
      }
    }

    // Log validation attempt
    await prisma.licenseValidation
      .create({
        data: {
          licenseId: license?.id || '',
          isValid,
          validationMessage: message,
          ipAddress,
          userAgent,
          deviceFingerprint,
        },
      })
      .catch(() => {
        // Ignore validation logging errors if license doesn't exist
      });

    return {
      valid: isValid,
      license: isValid ? license : null,
      message,
    };
  }

  /**
   * Deactivate a license (decrement activation count)
   */
  static async deactivateLicense(
    licenseKey: string,
    deviceFingerprint?: string,
    ipAddress?: string,
    userAgent?: string
  ) {
    const license = await prisma.license.findUnique({
      where: { licenseKey },
      include: {
        user: true,
      },
    });

    let success = false;
    let message = '';

    if (!license) {
      message = 'License key not found';
    } else if (license.currentActivations <= 0) {
      message = 'No active activations to deactivate';
    } else {
      // Decrement activation count
      await prisma.license.update({
        where: { id: license.id },
        data: {
          currentActivations: { decrement: 1 },
        },
      });

      success = true;
      message = 'License deactivated successfully';
    }

    // Log deactivation attempt
    await prisma.licenseValidation
      .create({
        data: {
          licenseId: license?.id || '',
          isValid: success,
          validationMessage: `Deactivation: ${message}`,
          ipAddress,
          userAgent,
          deviceFingerprint,
        },
      })
      .catch(() => {
        // Ignore validation logging errors if license doesn't exist
      });

    return {
      success,
      message,
      currentActivations:
        success && license ? license.currentActivations - 1 : license?.currentActivations,
    };
  }

  /**
   * Get license by key
   */
  static async getLicenseByKey(licenseKey: string) {
    return prisma.license.findUnique({
      where: { licenseKey },
      include: {
        user: true,
        validations: {
          orderBy: { createdAt: 'desc' },
          take: 10,
        },
      },
    });
  }

  /**
   * Get license by ID
   */
  static async getLicenseById(id: string) {
    return prisma.license.findUnique({
      where: { id },
      include: {
        user: true,
        validations: {
          orderBy: { createdAt: 'desc' },
          take: 10,
        },
      },
    });
  }

  /**
   * List licenses with optional filters
   */
  static async listLicenses(filters?: {
    userId?: string;
    status?: string;
    limit?: number;
    offset?: number;
  }) {
    const where: any = {};
    if (filters?.userId) where.userId = filters.userId;
    if (filters?.status) where.status = filters.status;

    const [licenses, total] = await Promise.all([
      prisma.license.findMany({
        where,
        include: {
          user: {
            select: {
              id: true,
              email: true,
              name: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        take: filters?.limit || 50,
        skip: filters?.offset || 0,
      }),
      prisma.license.count({ where }),
    ]);

    return { licenses, total };
  }

  /**
   * Update license
   */
  static async updateLicense(id: string, data: UpdateLicenseDTO) {
    return prisma.license.update({
      where: { id },
      data: {
        status: data.status,
        expiresAt: data.expiresAt ? new Date(data.expiresAt) : undefined,
        maxActivations: data.maxActivations,
        notes: data.notes,
        revokedAt: data.status === 'REVOKED' ? new Date() : undefined,
      },
      include: {
        user: true,
      },
    });
  }

  /**
   * Revoke license
   */
  static async revokeLicense(id: string, reason?: string) {
    return prisma.license.update({
      where: { id },
      data: {
        status: 'REVOKED',
        revokedAt: new Date(),
        notes: reason || 'License revoked',
      },
    });
  }

  /**
   * Delete license
   */
  static async deleteLicense(id: string) {
    return prisma.license.delete({
      where: { id },
    });
  }
}
