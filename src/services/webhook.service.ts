import { prisma } from '../lib/prisma';
import { WebhookStatus } from '@prisma/client';

export class WebhookError extends Error {
  constructor(
    message: string,
    public readonly isRetryable: boolean = true,
    public readonly statusCode: number = 500
  ) {
    super(message);
    this.name = 'WebhookError';
  }
}

interface WebhookProcessorOptions {
  source: string;
  eventType: string;
  eventId?: string;
  payload: any;
}

export class WebhookService {
  /**
   * Process a webhook with idempotency and status tracking
   * Returns the webhook event record
   */
  static async processWebhook<T>(
    options: WebhookProcessorOptions,
    processor: (payload: any) => Promise<T>
  ): Promise<{ result: T; webhookEvent: any; isNewEvent: boolean }> {
    const { source, eventType, eventId, payload } = options;

    // Check if we've already processed this event
    if (eventId) {
      const existing = await prisma.webhookEvent.findUnique({
        where: {
          source_eventId: {
            source,
            eventId,
          },
        },
      });

      if (existing) {
        if (existing.status === 'COMPLETED') {
          // Already processed successfully, return idempotent response
          return {
            result: existing.payload as T,
            webhookEvent: existing,
            isNewEvent: false,
          };
        }

        if (existing.status === 'PROCESSING') {
          // Another process is already handling this
          throw new WebhookError(
            'Webhook is already being processed',
            false, // Not retryable
            409
          );
        }
      }
    }

    // Create or update webhook event record
    const webhookEvent = eventId
      ? await prisma.webhookEvent.upsert({
          where: {
            source_eventId: {
              source,
              eventId,
            },
          },
          create: {
            source,
            eventType,
            eventId,
            payload,
            status: 'PROCESSING',
            attempts: 1,
            lastAttemptAt: new Date(),
          },
          update: {
            status: 'PROCESSING',
            attempts: { increment: 1 },
            lastAttemptAt: new Date(),
          },
        })
      : await prisma.webhookEvent.create({
          data: {
            source,
            eventType,
            eventId,
            payload,
            status: 'PROCESSING',
            attempts: 1,
            lastAttemptAt: new Date(),
          },
        });

    try {
      // Execute the processor function
      const result = await processor(payload);

      // Mark as completed
      await prisma.webhookEvent.update({
        where: { id: webhookEvent.id },
        data: {
          status: 'COMPLETED',
          completedAt: new Date(),
          lastError: null,
        },
      });

      return {
        result,
        webhookEvent,
        isNewEvent: true,
      };
    } catch (error: any) {
      // Handle failure
      const isRetryable = error instanceof WebhookError ? error.isRetryable : true;
      const errorMessage = error.message || 'Unknown error';

      const status: WebhookStatus = isRetryable ? 'RETRYING' : 'FAILED';

      await prisma.webhookEvent.update({
        where: { id: webhookEvent.id },
        data: {
          status,
          lastError: errorMessage,
        },
      });

      // Re-throw to let the caller handle the HTTP response
      throw error;
    }
  }

  /**
   * Get failed webhooks for manual review
   */
  static async getFailedWebhooks(source?: string, limit = 50) {
    return prisma.webhookEvent.findMany({
      where: {
        status: 'FAILED',
        source,
      },
      take: limit,
      orderBy: {
        createdAt: 'desc',
      },
    });
  }

  /**
   * Retry a failed webhook
   */
  static async retryWebhook(webhookId: string) {
    const webhook = await prisma.webhookEvent.findUnique({
      where: { id: webhookId },
    });

    if (!webhook) {
      throw new Error('Webhook not found');
    }

    if (webhook.status !== 'FAILED') {
      throw new Error(`Cannot retry webhook with status: ${webhook.status}`);
    }

    await prisma.webhookEvent.update({
      where: { id: webhookId },
      data: {
        status: 'PENDING',
        lastError: null,
      },
    });

    return webhook;
  }
}
