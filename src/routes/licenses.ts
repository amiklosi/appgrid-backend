import { FastifyPluginAsync } from 'fastify';
import { LicenseService } from '../services/license.service';
import {
  ValidateLicenseSchema,
  CheckLicenseSchema,
  DeactivateLicenseSchema,
  ValidationResponseSchema,
  DeactivationResponseSchema,
} from '../schemas/license.schema';

// License key format: XXXX-XXXX-XXXX-XXXX (alphanumeric, uppercase)
const LICENSE_KEY_REGEX = /^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/;

const RATE_LIMIT = {
  max: 10,
  timeWindow: '1 minute',
  errorResponseBuilder: () => ({
    valid: false,
    message: 'Too many requests, please try again later.',
  }),
};

const licensesRoutes: FastifyPluginAsync = async (fastify) => {
  // Validate a license key
  fastify.post(
    '/licenses/validate',
    {
      config: { rateLimit: RATE_LIMIT },
      schema: {
        body: ValidateLicenseSchema,
        response: { 200: ValidationResponseSchema },
        tags: ['licenses'],
        description: 'Validate a license key',
      },
    },
    async (request, reply) => {
      const { licenseKey, deviceFingerprint, deviceName } = request.body as any;

      if (!LICENSE_KEY_REGEX.test(licenseKey)) {
        return reply.send({ valid: false, message: 'Invalid license key format.' });
      }

      const result = await LicenseService.validateLicense(
        licenseKey,
        deviceFingerprint,
        request.ip,
        request.headers['user-agent'],
        deviceName
      );

      return reply.send(result);
    }
  );

  // Check a license key (read-only, no activation)
  fastify.post(
    '/licenses/check',
    {
      config: { rateLimit: RATE_LIMIT },
      schema: {
        body: CheckLicenseSchema,
        response: { 200: ValidationResponseSchema },
        tags: ['licenses'],
        description: 'Check a license key without activating (read-only)',
      },
    },
    async (request, reply) => {
      const { licenseKey, deviceFingerprint } = request.body as any;

      if (!LICENSE_KEY_REGEX.test(licenseKey)) {
        return reply.send({ valid: false, message: 'Invalid license key format.' });
      }

      const result = await LicenseService.checkLicense(licenseKey, deviceFingerprint);

      return reply.send(result);
    }
  );

  // Deactivate a license key
  fastify.post(
    '/licenses/deactivate',
    {
      config: { rateLimit: RATE_LIMIT },
      schema: {
        body: DeactivateLicenseSchema,
        response: { 200: DeactivationResponseSchema },
        tags: ['licenses'],
        description: 'Deactivate a license key (requires license key and device fingerprint)',
      },
    },
    async (request, reply) => {
      const { licenseKey, deviceFingerprint } = request.body as any;

      if (!LICENSE_KEY_REGEX.test(licenseKey)) {
        return reply.send({ success: false, message: 'Invalid license key format.' });
      }

      const result = await LicenseService.deactivateLicense(
        licenseKey,
        deviceFingerprint,
        request.ip,
        request.headers['user-agent']
      );

      return reply.send(result);
    }
  );
};

export default licensesRoutes;
