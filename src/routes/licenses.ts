import { FastifyPluginAsync } from 'fastify';
import { LicenseService } from '../services/license.service';
import {
  ValidateLicenseSchema,
  CheckLicenseSchema,
  DeactivateLicenseSchema,
  ValidationResponseSchema,
  DeactivationResponseSchema,
} from '../schemas/license.schema';

const licensesRoutes: FastifyPluginAsync = async (fastify) => {
  // Validate a license key
  fastify.post(
    '/licenses/validate',
    {
      schema: {
        body: ValidateLicenseSchema,
        response: {
          200: ValidationResponseSchema,
        },
        tags: ['licenses'],
        description: 'Validate a license key',
      },
    },
    async (request, reply) => {
      const { licenseKey, deviceFingerprint, deviceName } = request.body as any;
      const ipAddress = request.ip;
      const userAgent = request.headers['user-agent'];

      const result = await LicenseService.validateLicense(
        licenseKey,
        deviceFingerprint,
        ipAddress,
        userAgent,
        deviceName
      );

      return reply.send(result);
    }
  );

  // Check a license key (read-only, no activation)
  fastify.post(
    '/licenses/check',
    {
      schema: {
        body: CheckLicenseSchema,
        response: {
          200: ValidationResponseSchema,
        },
        tags: ['licenses'],
        description: 'Check a license key without activating (read-only)',
      },
    },
    async (request, reply) => {
      const { licenseKey, deviceFingerprint } = request.body as any;

      const result = await LicenseService.checkLicense(licenseKey, deviceFingerprint);

      return reply.send(result);
    }
  );

  // Deactivate a license key
  fastify.post(
    '/licenses/deactivate',
    {
      schema: {
        body: DeactivateLicenseSchema,
        response: {
          200: DeactivationResponseSchema,
        },
        tags: ['licenses'],
        description: 'Deactivate a license key (requires license key and device fingerprint)',
      },
    },
    async (request, reply) => {
      const { licenseKey, deviceFingerprint } = request.body as any;
      const ipAddress = request.ip;
      const userAgent = request.headers['user-agent'];

      const result = await LicenseService.deactivateLicense(
        licenseKey,
        deviceFingerprint,
        ipAddress,
        userAgent
      );

      return reply.send(result);
    }
  );
};

export default licensesRoutes;
