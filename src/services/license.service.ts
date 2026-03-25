import { randomBytes } from 'crypto';
import { prisma } from '../lib/prisma';
import type { CreateLicenseDTO, StartTrialDTO, UpdateLicenseDTO } from '../schemas/license.schema';

export type TrialResult =
  | { kind: 'new_trial'; licenseKey: string; expiresAt: string; isTrial: true }
  | { kind: 'existing_trial'; licenseKey: string; expiresAt: string; isTrial: true }
  | { kind: 'paid_license_exists'; licenseKey: string };

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
        isTrial: data.isTrial ?? false,
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
   * Check a license key (read-only, no activation or updates)
   */
  static async checkLicense(licenseKey: string, deviceFingerprint?: string) {
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
    } else {
      // Check device-level activation if fingerprint provided
      if (deviceFingerprint) {
        // Check if this device is already activated
        const existingActivation = license.deviceActivations.find(
          (d) => d.deviceFingerprint === deviceFingerprint
        );

        if (existingActivation) {
          isValid = true;
          message = 'License is valid for this device';
        } else {
          // Device is not activated
          isValid = false;
          message = 'Device not activated for this license';
        }
      } else {
        // No device fingerprint - just validate the license itself
        isValid = true;
        message = 'License is valid';
      }
    }

    return {
      valid: isValid,
      license:
        isValid && license
          ? {
              status: license.status,
              expiresAt: license.expiresAt?.toISOString() ?? null,
              isTrial: license.isTrial,
            }
          : null,
      message,
    };
  }

  /**
   * Validate a license key
   */
  static async validateLicense(
    licenseKey: string,
    deviceFingerprint?: string,
    ipAddress?: string,
    userAgent?: string,
    deviceName?: string
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
                deviceName,
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
        message = 'License is valid';
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
      license:
        isValid && license
          ? {
              status: license.status,
              expiresAt: license.expiresAt?.toISOString() ?? null,
              isTrial: license.isTrial,
            }
          : null,
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

    const newCount =
      success && license
        ? license.deviceActivations.length - 1
        : license?.deviceActivations?.length || 0;

    return {
      success,
      message,
      currentActivations: newCount,
    };
  }

  /**
   * Start a trial for a device.
   * Returns existing trial key if one already exists for this fingerprint.
   * The existence check runs inside the transaction so concurrent requests
   * are serialised by the DB — the unique constraint on device_fingerprint
   * acts as a final safety net.
   */
  static async startTrial(data: StartTrialDTO, trialDurationDays: number): Promise<TrialResult> {
    const { deviceFingerprint, deviceName } = data;

    const trialDurationMs = trialDurationDays * 86_400_000;
    const expiresAt = new Date(Date.now() + trialDurationMs);
    const placeholderEmail = `trial-${deviceFingerprint}@device.local`;

    return prisma.$transaction(async (tx) => {
      // Re-check inside the transaction to close the TOCTOU window
      const existingActivation = await tx.deviceActivation.findFirst({
        where: { deviceFingerprint },
        include: { license: true },
      });

      if (existingActivation) {
        const lic = existingActivation.license;
        if (lic.isTrial) {
          if (!lic.expiresAt) {
            throw new Error(`Trial license ${lic.licenseKey} has no expiry date`);
          }
          return {
            kind: 'existing_trial' as const,
            licenseKey: lic.licenseKey,
            expiresAt: lic.expiresAt.toISOString(),
            isTrial: true as const,
          };
        }
        return {
          kind: 'paid_license_exists' as const,
          licenseKey: lic.licenseKey,
        };
      }

      // Upsert the placeholder user
      const user = await tx.user.upsert({
        where: { email: placeholderEmail },
        update: {},
        create: {
          email: placeholderEmail,
          marketingConsent: false,
        },
      });

      // Create trial license
      const licenseKey = LicenseService.generateLicenseKey();
      const license = await tx.license.create({
        data: {
          userId: user.id,
          licenseKey,
          expiresAt,
          maxActivations: 1,
          isTrial: true,
          activatedAt: new Date(),
        },
      });

      // Create device activation — unique constraint on device_fingerprint
      // will reject a duplicate that slipped through a concurrent transaction
      await tx.deviceActivation.create({
        data: {
          licenseId: license.id,
          deviceFingerprint,
          deviceName,
        },
      });

      return {
        kind: 'new_trial' as const,
        licenseKey,
        expiresAt: expiresAt.toISOString(),
        isTrial: true as const,
      };
    });
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
