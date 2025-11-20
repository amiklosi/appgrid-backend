import { EmailQueueService } from './email-queue.service';

export class BackgroundJobsService {
  private emailQueueInterval: NodeJS.Timeout | null = null;
  private logger: any;

  constructor(logger: any) {
    this.logger = logger;
  }

  /**
   * Start all background jobs
   */
  start() {
    this.startEmailQueueProcessor();
    this.logger.info('Background jobs started');
  }

  /**
   * Stop all background jobs
   */
  stop() {
    if (this.emailQueueInterval) {
      clearInterval(this.emailQueueInterval);
      this.emailQueueInterval = null;
    }
    this.logger.info('Background jobs stopped');
  }

  /**
   * Start email queue processor
   * Runs every minute to process pending emails
   */
  private startEmailQueueProcessor() {
    // Process immediately on start
    this.processEmailQueue();

    // Then process every minute
    this.emailQueueInterval = setInterval(
      () => {
        this.processEmailQueue();
      },
      60 * 1000
    ); // 1 minute
  }

  private async processEmailQueue() {
    try {
      const result = await EmailQueueService.processPendingEmails(10);

      if (result.processed > 0) {
        this.logger.info(
          {
            processed: result.processed,
            succeeded: result.succeeded,
            failed: result.failed,
          },
          'Email queue processed'
        );
      }
    } catch (error: any) {
      this.logger.error({ error: error.message }, 'Failed to process email queue');
    }
  }
}
