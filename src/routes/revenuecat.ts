import { FastifyPluginAsync } from 'fastify';
import { prisma } from '../lib/prisma';
import { LicenseService } from '../services/license.service';
import { emailService } from '../lib/email';

const revenuecatRoutes: FastifyPluginAsync = async (fastify) => {
  // Migrate RevenueCat user to new license system
  fastify.post(
    '/revenuecat/migrate',
    {
      schema: {
        body: {
          type: 'object',
          required: ['email', 'userId'],
          properties: {
            email: { type: 'string', format: 'email' },
            userId: { type: 'string' },
          },
        },
        response: {
          200: {
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              alreadyMigrated: { type: 'boolean' },
              subscriptionType: { type: 'string' },
              licenseKey: { type: 'string' },
              email: { type: 'string' },
              userId: { type: 'string' },
              expiresAt: { type: ['string', 'null'] },
              emailSent: { type: 'boolean' },
            },
          },
          400: {
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              error: { type: 'string' },
            },
          },
          500: {
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              error: { type: 'string' },
            },
          },
        },
        tags: ['revenuecat'],
        description: 'Migrate RevenueCat user with lifetime purchase to new license system',
      },
    },
    async (request, reply) => {
      try {
        const { email, userId } = request.body as { email: string; userId: string };
        const apiKey = process.env.REVENUECAT_API_KEY;
        const projectId = process.env.REVENUECAT_PROJECT_ID;

        if (!apiKey || !projectId) {
          return reply.code(500).send({
            success: false,
            error: 'RevenueCat configuration missing',
          });
        }

        // Check if already migrated
        const existingMigration = await prisma.revenueCatMigration.findUnique({
          where: { revenueCatUserId: userId },
          include: {
            license: true,
            user: true,
          },
        });

        if (existingMigration) {
          fastify.log.info(
            {
              userId,
              email,
              licenseKey: existingMigration.license.licenseKey,
            },
            'User already migrated'
          );

          return reply.send({
            success: true,
            alreadyMigrated: true,
            licenseKey: existingMigration.license.licenseKey,
            email: existingMigration.email,
            userId,
            expiresAt: existingMigration.license.expiresAt?.toISOString() || null,
            emailSent: existingMigration.emailSent,
          });
        }

        // Call RevenueCat API V2 to get customer info
        const response = await fetch(
          `https://api.revenuecat.com/v2/projects/${encodeURIComponent(projectId)}/customers/${encodeURIComponent(userId)}`,
          {
            method: 'GET',
            headers: {
              Authorization: `Bearer ${apiKey}`,
              'Content-Type': 'application/json',
            },
          }
        );

        if (!response.ok) {
          const errorText = await response.text();
          fastify.log.error(
            {
              status: response.status,
              error: errorText,
            },
            'RevenueCat API request failed'
          );

          return reply.code(500).send({
            success: false,
            error: `RevenueCat API error: ${response.statusText}`,
          });
        }

        const data = (await response.json()) as any;
        const entitlements = data.active_entitlements?.items || [];

        // Check for lifetime purchase or annual subscription
        let isEligible = false;
        let licenseExpiresAt: Date | undefined = undefined;
        let subscriptionType = '';

        for (const entitlement of entitlements) {
          const expiresAt = entitlement.expires_at;

          // Lifetime purchase (no expiration)
          if (expiresAt === null || expiresAt === undefined) {
            isEligible = true;
            licenseExpiresAt = undefined;
            subscriptionType = 'lifetime';
            break;
          }

          // Check if it's an annual subscription (expires at least 11 months from now)
          const expirationDate = new Date(expiresAt);
          const now = new Date();
          const monthsUntilExpiration =
            (expirationDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24 * 30);

          if (monthsUntilExpiration >= 11) {
            isEligible = true;
            licenseExpiresAt = expirationDate;
            subscriptionType = 'annual';
            break;
          }
        }

        if (!isEligible) {
          fastify.log.info(
            {
              userId,
              email,
              entitlements,
            },
            'No eligible purchase found (must be lifetime or annual subscription)'
          );

          return reply.code(400).send({
            success: false,
            error:
              'No eligible purchase found. Only lifetime and annual subscriptions can be migrated.',
          });
        }

        fastify.log.info(
          {
            userId,
            email,
            subscriptionType,
            expiresAt: licenseExpiresAt?.toISOString(),
          },
          'Eligible subscription found'
        );

        // Create or find user
        let user = await prisma.user.findUnique({
          where: { email },
        });

        if (!user) {
          user = await prisma.user.create({
            data: {
              email,
              name: null,
            },
          });
          fastify.log.info({ userId: user.id, email }, 'Created new user');
        }

        // Create license
        const license = await LicenseService.createLicense({
          userId: user.id,
          expiresAt: licenseExpiresAt?.toISOString(),
          maxActivations: 5, // Allow multiple devices
          notes: `Migrated from RevenueCat user: ${userId} (${subscriptionType})`,
          metadata: {
            source: 'revenuecat_migration',
            subscriptionType,
            revenueCatUserId: userId,
            revenueCatData: data,
          },
        });

        fastify.log.info(
          {
            userId,
            email,
            licenseKey: license.licenseKey,
          },
          'Created new license'
        );

        // Send email
        let emailSent = false;
        let emailSentAt = null;

        const emailResult = await emailService.sendMigrationLicenseEmail(email, {
          licenseKey: license.licenseKey,
          isLifetime: subscriptionType === 'lifetime',
          expirationDate: licenseExpiresAt?.toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'long',
            day: 'numeric',
          }),
          maxActivations: 5,
        });

        if (emailResult.success) {
          emailSent = true;
          emailSentAt = new Date();
          fastify.log.info(
            {
              userId,
              email,
              messageId: emailResult.messageId,
            },
            'Email sent successfully'
          );
        } else {
          fastify.log.error(
            {
              userId,
              email,
              error: emailResult.error,
            },
            'Failed to send email'
          );
        }

        // Create migration record
        await prisma.revenueCatMigration.create({
          data: {
            revenueCatUserId: userId,
            email,
            licenseId: license.id,
            userId: user.id,
            emailSent,
            emailSentAt,
            revenueCatData: data,
          },
        });

        fastify.log.info(
          {
            userId,
            email,
            licenseKey: license.licenseKey,
            emailSent,
          },
          'Migration completed successfully'
        );

        return reply.send({
          success: true,
          alreadyMigrated: false,
          subscriptionType,
          licenseKey: license.licenseKey,
          email,
          userId,
          expiresAt: licenseExpiresAt?.toISOString() || null,
          emailSent,
        });
      } catch (error: any) {
        fastify.log.error({ error: error.message }, 'Migration failed');

        return reply.code(500).send({
          success: false,
          error: error.message || 'Migration failed',
        });
      }
    }
  );
};

export default revenuecatRoutes;
