import { prisma } from '../lib/prisma';
import { emailService } from '../lib/email';

interface QueueEmailOptions {
  to: string;
  subject: string;
  textContent: string;
  htmlContent: string;
  metadata?: any;
  maxAttempts?: number;
}

export class EmailQueueService {
  /**
   * Add an email to the queue for reliable delivery
   */
  static async queueEmail(options: QueueEmailOptions) {
    const email = await prisma.emailQueue.create({
      data: {
        to: options.to,
        subject: options.subject,
        textContent: options.textContent,
        htmlContent: options.htmlContent,
        status: 'PENDING',
        attempts: 0,
        maxAttempts: options.maxAttempts || 5,
        metadata: options.metadata || {},
        nextRetryAt: new Date(), // Send immediately
      },
    });

    return email;
  }

  /**
   * Process pending emails in the queue
   * Should be called by a background job/cron
   */
  static async processPendingEmails(limit = 10) {
    const now = new Date();

    // Find pending or retrying emails that are ready to be sent
    const emails = await prisma.emailQueue.findMany({
      where: {
        status: {
          in: ['PENDING', 'RETRYING'],
        },
        attempts: {
          lt: prisma.emailQueue.fields.maxAttempts,
        },
        nextRetryAt: {
          lte: now,
        },
      },
      take: limit,
      orderBy: {
        nextRetryAt: 'asc',
      },
    });

    const results = await Promise.allSettled(
      emails.map((email) => this.sendEmail(email.id))
    );

    return {
      processed: emails.length,
      succeeded: results.filter((r) => r.status === 'fulfilled').length,
      failed: results.filter((r) => r.status === 'rejected').length,
    };
  }

  /**
   * Send a specific email from the queue
   */
  private static async sendEmail(emailId: string) {
    // Lock the email for processing
    const email = await prisma.emailQueue.findUnique({
      where: { id: emailId },
    });

    if (!email || email.status === 'SENT') {
      return;
    }

    // Update to SENDING status
    await prisma.emailQueue.update({
      where: { id: emailId },
      data: {
        status: 'SENDING',
        attempts: { increment: 1 },
        lastAttemptAt: new Date(),
      },
    });

    try {
      // Attempt to send via Mailgun
      const result = await emailService.sendRawEmail(
        email.to,
        email.subject,
        email.textContent,
        email.htmlContent
      );

      if (result.success) {
        // Mark as sent
        await prisma.emailQueue.update({
          where: { id: emailId },
          data: {
            status: 'SENT',
            sentAt: new Date(),
            messageId: result.messageId,
            lastError: null,
          },
        });
      } else {
        // Handle failure
        await this.handleEmailFailure(emailId, result.error || 'Unknown error');
      }
    } catch (error: any) {
      await this.handleEmailFailure(emailId, error.message);
    }
  }

  /**
   * Handle email send failure with exponential backoff
   */
  private static async handleEmailFailure(emailId: string, errorMessage: string) {
    const email = await prisma.emailQueue.findUnique({
      where: { id: emailId },
    });

    if (!email) return;

    const hasMoreAttempts = email.attempts < email.maxAttempts;

    if (hasMoreAttempts) {
      // Calculate exponential backoff: 1min, 5min, 15min, 1hr, 4hr
      const backoffMinutes = [1, 5, 15, 60, 240];
      const backoffIndex = Math.min(email.attempts - 1, backoffMinutes.length - 1);
      const minutesToWait = backoffMinutes[backoffIndex];
      const nextRetryAt = new Date(Date.now() + minutesToWait * 60 * 1000);

      await prisma.emailQueue.update({
        where: { id: emailId },
        data: {
          status: 'RETRYING',
          lastError: errorMessage,
          nextRetryAt,
        },
      });
    } else {
      // Max attempts reached, mark as failed
      await prisma.emailQueue.update({
        where: { id: emailId },
        data: {
          status: 'FAILED',
          lastError: `Max attempts (${email.maxAttempts}) reached. Last error: ${errorMessage}`,
        },
      });
    }
  }

  /**
   * Get failed emails for manual review
   */
  static async getFailedEmails(limit = 50) {
    return prisma.emailQueue.findMany({
      where: {
        status: 'FAILED',
      },
      take: limit,
      orderBy: {
        createdAt: 'desc',
      },
    });
  }

  /**
   * Retry a failed email manually
   */
  static async retryEmail(emailId: string) {
    const email = await prisma.emailQueue.findUnique({
      where: { id: emailId },
    });

    if (!email) {
      throw new Error('Email not found');
    }

    await prisma.emailQueue.update({
      where: { id: emailId },
      data: {
        status: 'PENDING',
        attempts: 0,
        lastError: null,
        nextRetryAt: new Date(),
      },
    });

    return this.sendEmail(emailId);
  }
}
