import 'dotenv/config';
import Fastify, { FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import { prisma } from './lib/prisma';

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
      cica: 'malac',
      status: 'ok',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
    };
  });

  // API info
  fastify.get('/', async (request, reply) => {
    return {
      name: 'AppGrid License Server',
      version: '1.0.0',
      endpoints: {
        health: '/health',
        licenses: '/api/licenses',
        emailTest: '/api/email/test',
        revenuecatMigrate: '/api/revenuecat/migrate',
      },
    };
  });

  // Import and register API routes
  await fastify.register(import('./routes/licenses'), { prefix: '/api' });
  await fastify.register(import('./routes/email'), { prefix: '/api' });
  await fastify.register(import('./routes/revenuecat'), { prefix: '/api' });

  return fastify;
}

// Start server
async function start() {
  try {
    const app = await buildApp();

    // Graceful shutdown
    const closeGracefully = async (signal: string) => {
      app.log.info(`Received ${signal}, closing server gracefully...`);
      await prisma.$disconnect();
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
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}

// Only start the server if this file is run directly (not imported for testing)
if (require.main === module) {
  start();
}
