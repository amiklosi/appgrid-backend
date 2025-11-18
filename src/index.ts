import 'dotenv/config';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import { prisma } from './lib/prisma';

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const NODE_ENV = process.env.NODE_ENV || 'development';

// Create Fastify instance
const fastify = Fastify({
  logger: {
    level: NODE_ENV === 'development' ? 'info' : 'warn',
    transport: NODE_ENV === 'development' ? {
      target: 'pino-pretty',
      options: {
        translateTime: 'HH:MM:ss Z',
        ignore: 'pid,hostname',
      },
    } : undefined,
  },
});

// Register plugins
async function registerPlugins() {
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
}

// Register routes
async function registerRoutes() {
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
      },
    };
  });

  // Import and register API routes
  await fastify.register(import('./routes/licenses'), { prefix: '/api' });
  await fastify.register(import('./routes/email'), { prefix: '/api' });
}

// Graceful shutdown
async function closeGracefully(signal: string) {
  fastify.log.info(`Received ${signal}, closing server gracefully...`);
  await prisma.$disconnect();
  await fastify.close();
  process.exit(0);
}

process.on('SIGINT', () => closeGracefully('SIGINT'));
process.on('SIGTERM', () => closeGracefully('SIGTERM'));

// Start server
async function start() {
  try {
    // Register plugins and routes
    await registerPlugins();
    await registerRoutes();

    // Start listening
    await fastify.listen({ port: PORT, host: HOST });

    fastify.log.info(`🚀 License key server running on port ${PORT}`);
    fastify.log.info(`🏥 Health check: http://localhost:${PORT}/health`);
    fastify.log.info(`📚 API docs: http://localhost:${PORT}/`);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
}

start();
