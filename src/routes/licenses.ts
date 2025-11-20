import { FastifyPluginAsync } from 'fastify';
import { LicenseService } from '../services/license.service';
import {
  CreateLicenseSchema,
  ValidateLicenseSchema,
  CheckLicenseSchema,
  DeactivateLicenseSchema,
  UpdateLicenseSchema,
  LicenseResponseSchema,
  ValidationResponseSchema,
  DeactivationResponseSchema,
} from '../schemas/license.schema';

const licensesRoutes: FastifyPluginAsync = async (fastify) => {
  // Create a new license
  fastify.post(
    '/licenses',
    {
      schema: {
        body: CreateLicenseSchema,
        response: {
          201: LicenseResponseSchema,
        },
        tags: ['licenses'],
        description: 'Generate a new license key',
      },
    },
    async (request, reply) => {
      const license = await LicenseService.createLicense(request.body as any);
      return reply.code(201).send(license);
    }
  );

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

      const result = await LicenseService.checkLicense(
        licenseKey,
        deviceFingerprint
      );

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

  // Get license by key
  fastify.get(
    '/licenses/key/:licenseKey',
    {
      schema: {
        params: {
          type: 'object',
          properties: {
            licenseKey: { type: 'string' },
          },
          required: ['licenseKey'],
        },
        response: {
          200: LicenseResponseSchema,
          404: {
            type: 'object',
            properties: {
              error: { type: 'string' },
            },
          },
        },
        tags: ['licenses'],
        description: 'Get license details by key',
      },
    },
    async (request, reply) => {
      const { licenseKey } = request.params as { licenseKey: string };
      const license = await LicenseService.getLicenseByKey(licenseKey);

      if (!license) {
        return reply.code(404).send({ error: 'License not found' });
      }

      return reply.send(license);
    }
  );

  // Get license by ID
  fastify.get(
    '/licenses/:id',
    {
      schema: {
        params: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
          },
          required: ['id'],
        },
        response: {
          200: LicenseResponseSchema,
          404: {
            type: 'object',
            properties: {
              error: { type: 'string' },
            },
          },
        },
        tags: ['licenses'],
        description: 'Get license details by ID',
      },
    },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const license = await LicenseService.getLicenseById(id);

      if (!license) {
        return reply.code(404).send({ error: 'License not found' });
      }

      return reply.send(license);
    }
  );

  // List licenses
  fastify.get(
    '/licenses',
    {
      schema: {
        querystring: {
          type: 'object',
          properties: {
            userId: { type: 'string', format: 'uuid' },
            status: { type: 'string', enum: ['ACTIVE', 'EXPIRED', 'REVOKED', 'SUSPENDED'] },
            limit: { type: 'integer', minimum: 1, maximum: 100, default: 50 },
            offset: { type: 'integer', minimum: 0, default: 0 },
          },
        },
        response: {
          200: {
            type: 'object',
            properties: {
              licenses: {
                type: 'array',
                items: LicenseResponseSchema,
              },
              total: { type: 'integer' },
            },
          },
        },
        tags: ['licenses'],
        description: 'List licenses with optional filters',
      },
    },
    async (request, reply) => {
      const filters = request.query as any;
      const result = await LicenseService.listLicenses(filters);
      return reply.send(result);
    }
  );

  // Update license
  fastify.patch(
    '/licenses/:id',
    {
      schema: {
        params: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
          },
          required: ['id'],
        },
        body: UpdateLicenseSchema,
        response: {
          200: LicenseResponseSchema,
          404: {
            type: 'object',
            properties: {
              error: { type: 'string' },
            },
          },
        },
        tags: ['licenses'],
        description: 'Update license details',
      },
    },
    async (request, reply) => {
      const { id } = request.params as { id: string };

      try {
        const license = await LicenseService.updateLicense(id, request.body as any);
        return reply.send(license);
      } catch (error: any) {
        if (error.code === 'P2025') {
          return reply.code(404).send({ error: 'License not found' });
        }
        throw error;
      }
    }
  );

  // Revoke license
  fastify.post(
    '/licenses/:id/revoke',
    {
      schema: {
        params: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
          },
          required: ['id'],
        },
        body: {
          type: 'object',
          properties: {
            reason: { type: 'string' },
          },
        },
        response: {
          200: LicenseResponseSchema,
          404: {
            type: 'object',
            properties: {
              error: { type: 'string' },
            },
          },
        },
        tags: ['licenses'],
        description: 'Revoke a license',
      },
    },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const { reason } = request.body as { reason?: string };

      try {
        const license = await LicenseService.revokeLicense(id, reason);
        return reply.send(license);
      } catch (error: any) {
        if (error.code === 'P2025') {
          return reply.code(404).send({ error: 'License not found' });
        }
        throw error;
      }
    }
  );

  // Delete license
  fastify.delete(
    '/licenses/:id',
    {
      schema: {
        params: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
          },
          required: ['id'],
        },
        response: {
          204: {
            type: 'null',
          },
          404: {
            type: 'object',
            properties: {
              error: { type: 'string' },
            },
          },
        },
        tags: ['licenses'],
        description: 'Delete a license',
      },
    },
    async (request, reply) => {
      const { id } = request.params as { id: string };

      try {
        await LicenseService.deleteLicense(id);
        return reply.code(204).send();
      } catch (error: any) {
        if (error.code === 'P2025') {
          return reply.code(404).send({ error: 'License not found' });
        }
        throw error;
      }
    }
  );
};

export default licensesRoutes;
