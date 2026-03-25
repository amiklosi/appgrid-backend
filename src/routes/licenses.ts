import { FastifyPluginAsync } from 'fastify';
import { Type } from '@sinclair/typebox';
import { LicenseService } from '../services/license.service';
import {
  ValidateLicenseSchema,
  CheckLicenseSchema,
  DeactivateLicenseSchema,
  ValidationResponseSchema,
  DeactivationResponseSchema,
  StartTrialSchema,
  StartTrialResponseSchema,
} from '../schemas/license.schema';

const TrialConflictResponseSchema = Type.Object({
  error: Type.String(),
  message: Type.String(),
});

// License key format: XXXX-XXXX-XXXX-XXXX (alphanumeric, uppercase)
const LICENSE_KEY_REGEX = /^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/;

const maskKey = (key: string) => `${key.slice(0, 4)}-****-****-****`;

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

      request.log.info(
        { key: maskKey(licenseKey), valid: result.valid, ip: request.ip },
        'license validate'
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

      request.log.info(
        { key: maskKey(licenseKey), valid: result.valid, ip: request.ip },
        'license check'
      );
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

      request.log.info(
        { key: maskKey(licenseKey), success: result.success, ip: request.ip },
        'license deactivate'
      );
      return reply.send(result);
    }
  );
  // Start a trial
  fastify.post(
    '/licenses/trial',
    {
      config: { rateLimit: RATE_LIMIT },
      schema: {
        body: StartTrialSchema,
        response: {
          200: StartTrialResponseSchema,
          409: TrialConflictResponseSchema,
        },
        tags: ['licenses'],
        description: 'Start a free trial for a device (keyed on device fingerprint)',
      },
    },
    async (request, reply) => {
      const { deviceFingerprint, deviceName } = request.body as any;
      const trialDurationDays = parseInt(process.env.TRIAL_DURATION_DAYS ?? '3', 10);

      const result = await LicenseService.startTrial(
        { deviceFingerprint, deviceName },
        trialDurationDays
      );

      if (result.kind === 'paid_license_exists') {
        return reply.status(409).send({
          error: 'paid_license_exists',
          message: 'A paid license is already activated for this device.',
        });
      }

      request.log.info(
        { fingerprint: deviceFingerprint?.slice(0, 8) + '...', ip: request.ip },
        'trial started'
      );

      return reply.send({
        licenseKey: result.licenseKey,
        expiresAt: result.expiresAt,
        isTrial: true,
      });
    }
  );
};

export default licensesRoutes;
