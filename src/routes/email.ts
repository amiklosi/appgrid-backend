import { FastifyPluginAsync } from 'fastify';
import formData from 'form-data';
import Mailgun from 'mailgun.js';

const emailRoutes: FastifyPluginAsync = async (fastify) => {
  // Test email endpoint
  fastify.get(
    '/email/test',
    {
      schema: {
        response: {
          200: {
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              message: { type: 'string' },
              messageId: { type: 'string' },
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
        tags: ['email'],
        description: 'Send a test email using Mailgun',
      },
    },
    async (request, reply) => {
      try {
        const apiKey = process.env.MAILGUN_API_KEY;
        const domain = process.env.MAILGUN_DOMAIN;

        if (!apiKey) {
          return reply.code(500).send({
            success: false,
            error: 'MAILGUN_API_KEY is not configured',
          });
        }

        if (!domain) {
          return reply.code(500).send({
            success: false,
            error: 'MAILGUN_DOMAIN is not configured',
          });
        }

        const mailgun = new Mailgun(formData);
        const mg = mailgun.client({
          username: 'api',
          key: apiKey,
          url: 'https://api.eu.mailgun.net',
        });

        const messageData = {
          from: 'AppGrid Test <info@zekalogic.com>',
          to: ['attila.miklosi+perec@gmail.com'],
          subject: 'Test Email from AppGrid Backend',
          text: 'This is a test email sent from the AppGrid Backend using Mailgun!',
          html: '<h1>Test Email</h1><p>This is a test email sent from the AppGrid Backend using Mailgun!</p>',
        };

        const result = await mg.messages.create(domain, messageData);

        fastify.log.info({ messageId: result.id }, 'Email sent successfully');

        return reply.send({
          success: true,
          message: 'Test email sent successfully',
          messageId: result.id,
        });
      } catch (error: any) {
        fastify.log.error({ error: error.message }, 'Failed to send email');

        return reply.code(500).send({
          success: false,
          error: error.message || 'Failed to send email',
        });
      }
    }
  );
};

export default emailRoutes;
