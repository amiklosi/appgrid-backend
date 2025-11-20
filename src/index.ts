import 'dotenv/config';
import Fastify, { FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import { prisma } from './lib/prisma';
import { ConfigValidator } from './lib/config-validator';
import { BackgroundJobsService } from './services/background-jobs.service';

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const NODE_ENV = process.env.NODE_ENV || 'development';

// Build Fastify app (exported for testing)
export async function buildApp(): Promise<FastifyInstance> {
  const fastify = Fastify({
    logger: {
      level: NODE_ENV === 'development' ? 'info' : 'warn',
      transport:
        NODE_ENV === 'development'
          ? {
              target: 'pino-pretty',
              options: {
                translateTime: 'HH:MM:ss Z',
                ignore: 'pid,hostname',
              },
            }
          : undefined,
    },
  });

  // Validate configuration at startup
  const configResult = ConfigValidator.logValidation(fastify.log);
  if (!configResult.valid) {
    throw new Error('Configuration validation failed - server cannot start. Check logs for details.');
  }

  // Register plugins
  // CORS
  await fastify.register(cors, {
    origin: true, // Allow all origins in development, configure for production
  });

  // Security headers
  await fastify.register(helmet, {
    contentSecurityPolicy: false, // Disable for API
  });

  // Rate limiting
  await fastify.register(rateLimit, {
    max: 100, // requests
    timeWindow: '1 minute',
  });

  // Register routes
  // Health check
  fastify.get('/health', async (request, reply) => {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
    };
  });

  // API info
  fastify.get('/', async (request, reply) => {
    return {
      name: 'AppGrid License Server',
      version: '2.0.0',
      resilience: 'enabled',
      endpoints: {
        health: '/health',
        licenses: '/api/licenses',
        emailTest: '/api/email/test',
        revenuecatMigrate: '/api/revenuecat/migrate',
        paddleWebhook: '/api/paddle/webhook',
        admin: {
          emailQueueStats: '/api/admin/email-queue/stats',
          emailQueueProcess: '/api/admin/email-queue/process',
          webhookStats: '/api/admin/webhooks/stats',
        },
      },
    };
  });

  // Import and register API routes
  await fastify.register(import('./routes/licenses'), { prefix: '/api' });
  await fastify.register(import('./routes/email'), { prefix: '/api' });
  await fastify.register(import('./routes/revenuecat'), { prefix: '/api' });
  await fastify.register(import('./routes/admin'), { prefix: '/api' });
  await fastify.register(import('./routes/paddle'), { prefix: '/api' });

  return fastify;
}

// Start server
async function start() {
  let backgroundJobs: BackgroundJobsService | null = null;

  try {
    const app = await buildApp();

    // Start background jobs
    backgroundJobs = new BackgroundJobsService(app.log);
    backgroundJobs.start();

    // Graceful shutdown
    const closeGracefully = async (signal: string) => {
      app.log.info(`Received ${signal}, closing server gracefully...`);

      // Stop background jobs first
      if (backgroundJobs) {
        backgroundJobs.stop();
      }

      // Close database connection
      await prisma.$disconnect();

      // Close server
      await app.close();

      process.exit(0);
    };

    process.on('SIGINT', () => closeGracefully('SIGINT'));
    process.on('SIGTERM', () => closeGracefully('SIGTERM'));

    // Start listening
    await app.listen({ port: PORT, host: HOST });

    app.log.info(`🚀 License key server running on port ${PORT}`);
    app.log.info(`🏥 Health check: http://localhost:${PORT}/health`);
    app.log.info(`📚 API docs: http://localhost:${PORT}/`);
    app.log.info(`🔐 Resilient webhook processing enabled`);
    app.log.info(`📧 Email queue background processor running`);
  } catch (err) {
    console.error('Failed to start server:', err);
    process.exit(1);
  }
}

// Only start the server if this file is run directly (not imported for testing)
if (require.main === module) {
  start();
}
