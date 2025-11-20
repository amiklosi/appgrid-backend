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
   * @param data License creation data
   * @param tx Optional Prisma transaction client for atomic operations
   */
  static async createLicense(data: CreateLicenseDTO, tx?: any) {
    const licenseKey = this.generateLicenseKey();
    const client = tx || prisma;

    const license = await client.license.create({
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
        deviceActivations: true,
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
    } else {
      // Check device-level activation if fingerprint provided
      if (deviceFingerprint) {
        // Check if this device is already activated
        const existingActivation = license.deviceActivations.find(
          (d) => d.deviceFingerprint === deviceFingerprint
        );

        if (existingActivation) {
          // Device already activated - update last seen
          await prisma.deviceActivation.update({
            where: { id: existingActivation.id },
            data: { lastSeenAt: new Date() },
          });
          isValid = true;
          message = 'License is valid';
        } else {
          // New device - check if we can add it
          const activeDeviceCount = license.deviceActivations.length;

          if (activeDeviceCount >= license.maxActivations) {
            message = 'Maximum activations reached';
          } else {
            // Activate new device
            await prisma.deviceActivation.create({
              data: {
                licenseId: license.id,
                deviceFingerprint,
                ipAddress,
                userAgent,
              },
            });

            // Update license first activation timestamp if needed
            if (!license.activatedAt) {
              await prisma.license.update({
                where: { id: license.id },
                data: {
                  activatedAt: new Date(),
                },
              });
            }

            isValid = true;
            message = 'License is valid';
          }
        }
      } else {
        // No device fingerprint - just validate the license itself
        isValid = true;
        message = 'License is valid (no device tracking)';
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
   * Deactivate a license (remove device activation)
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
        deviceActivations: true,
      },
    });

    let success = false;
    let message = '';

    if (!license) {
      message = 'License key not found';
    } else if (!deviceFingerprint) {
      message = 'Device fingerprint required for deactivation';
    } else {
      // Find the device activation
      const deviceActivation = license.deviceActivations.find(
        (d) => d.deviceFingerprint === deviceFingerprint
      );

      if (!deviceActivation) {
        message = 'Device not activated for this license';
      } else {
        // Remove device activation
        await prisma.deviceActivation.delete({
          where: { id: deviceActivation.id },
        });

        success = true;
        message = 'License deactivated successfully';
      }
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

    const newCount = success && license ? license.deviceActivations.length - 1 : license?.deviceActivations?.length || 0;

    return {
      success,
      message,
      currentActivations: newCount,
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
