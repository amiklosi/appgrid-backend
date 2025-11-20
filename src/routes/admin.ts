import { FastifyPluginAsync } from 'fastify';
import { EmailQueueService } from '../services/email-queue.service';
import { WebhookService } from '../services/webhook.service';
import { prisma } from '../lib/prisma';

const adminRoutes: FastifyPluginAsync = async (fastify) => {
  /**
   * Process pending emails in the queue
   * Can be called manually or by a cron job
   */
  fastify.post('/admin/email-queue/process', async (request, reply) => {
    try {
      const limit = (request.query as any).limit || 10;
      const result = await EmailQueueService.processPendingEmails(limit);

      return reply.send({
        success: true,
        ...result,
      });
    } catch (error: any) {
      fastify.log.error({ error: error.message }, 'Failed to process email queue');
      return reply.code(500).send({
        success: false,
        error: error.message,
      });
    }
  });

  /**
   * Get failed emails for review
   */
  fastify.get('/admin/email-queue/failed', async (request, reply) => {
    try {
      const limit = (request.query as any).limit || 50;
      const failedEmails = await EmailQueueService.getFailedEmails(limit);

      return reply.send({
        success: true,
        count: failedEmails.length,
        emails: failedEmails,
      });
    } catch (error: any) {
      fastify.log.error({ error: error.message }, 'Failed to get failed emails');
      return reply.code(500).send({
        success: false,
        error: error.message,
      });
    }
  });

  /**
   * Retry a failed email
   */
  fastify.post('/admin/email-queue/:emailId/retry', async (request, reply) => {
    try {
      const { emailId } = request.params as { emailId: string };
      await EmailQueueService.retryEmail(emailId);

      return reply.send({
        success: true,
        message: 'Email retry initiated',
      });
    } catch (error: any) {
      fastify.log.error({ error: error.message }, 'Failed to retry email');
      return reply.code(500).send({
        success: false,
        error: error.message,
      });
    }
  });

  /**
   * Get email queue stats
   */
  fastify.get('/admin/email-queue/stats', async (request, reply) => {
    try {
      const [pending, sending, sent, failed, retrying] = await Promise.all([
        prisma.emailQueue.count({ where: { status: 'PENDING' } }),
        prisma.emailQueue.count({ where: { status: 'SENDING' } }),
        prisma.emailQueue.count({ where: { status: 'SENT' } }),
        prisma.emailQueue.count({ where: { status: 'FAILED' } }),
        prisma.emailQueue.count({ where: { status: 'RETRYING' } }),
      ]);

      return reply.send({
        success: true,
        stats: {
          pending,
          sending,
          sent,
          failed,
          retrying,
          total: pending + sending + sent + failed + retrying,
        },
      });
    } catch (error: any) {
      fastify.log.error({ error: error.message }, 'Failed to get email queue stats');
      return reply.code(500).send({
        success: false,
        error: error.message,
      });
    }
  });

  /**
   * Get failed webhooks for review
   */
  fastify.get('/admin/webhooks/failed', async (request, reply) => {
    try {
      const source = (request.query as any).source;
      const limit = (request.query as any).limit || 50;
      const failedWebhooks = await WebhookService.getFailedWebhooks(source, limit);

      return reply.send({
        success: true,
        count: failedWebhooks.length,
        webhooks: failedWebhooks,
      });
    } catch (error: any) {
      fastify.log.error({ error: error.message }, 'Failed to get failed webhooks');
      return reply.code(500).send({
        success: false,
        error: error.message,
      });
    }
  });

  /**
   * Retry a failed webhook
   */
  fastify.post('/admin/webhooks/:webhookId/retry', async (request, reply) => {
    try {
      const { webhookId } = request.params as { webhookId: string };
      const webhook = await WebhookService.retryWebhook(webhookId);

      return reply.send({
        success: true,
        message: 'Webhook marked for retry',
        webhook,
      });
    } catch (error: any) {
      fastify.log.error({ error: error.message }, 'Failed to retry webhook');
      return reply.code(500).send({
        success: false,
        error: error.message,
      });
    }
  });

  /**
   * Get webhook stats
   */
  fastify.get('/admin/webhooks/stats', async (request, reply) => {
    try {
      const source = (request.query as any).source;
      const where = source ? { source } : {};

      const [pending, processing, completed, failed, retrying] = await Promise.all([
        prisma.webhookEvent.count({ where: { ...where, status: 'PENDING' } }),
        prisma.webhookEvent.count({ where: { ...where, status: 'PROCESSING' } }),
        prisma.webhookEvent.count({ where: { ...where, status: 'COMPLETED' } }),
        prisma.webhookEvent.count({ where: { ...where, status: 'FAILED' } }),
        prisma.webhookEvent.count({ where: { ...where, status: 'RETRYING' } }),
      ]);

      return reply.send({
        success: true,
        stats: {
          pending,
          processing,
          completed,
          failed,
          retrying,
          total: pending + processing + completed + failed + retrying,
        },
      });
    } catch (error: any) {
      fastify.log.error({ error: error.message }, 'Failed to get webhook stats');
      return reply.code(500).send({
        success: false,
        error: error.message,
      });
    }
  });
};

export default adminRoutes;
