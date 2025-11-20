import Handlebars from 'handlebars';
import { readFileSync } from 'fs';
import { join } from 'path';
import formData from 'form-data';
import Mailgun from 'mailgun.js';

interface EmailTemplate {
  subject: string;
  text: string;
  html: string;
}

interface MigrationLicenseData {
  licenseKey: string;
  isLifetime: boolean;
  expirationDate?: string;
  maxActivations: number;
}

class EmailService {
  private templatesPath = join(__dirname, '../templates/emails');
  private mg: ReturnType<Mailgun['client']> | null = null;
  private domain: string | null = null;

  constructor() {
    const mailgunApiKey = process.env.MAILGUN_API_KEY;
    const mailgunDomain = process.env.MAILGUN_DOMAIN;

    if (mailgunApiKey && mailgunDomain) {
      const mailgun = new Mailgun(formData);
      this.mg = mailgun.client({
        username: 'api',
        key: mailgunApiKey,
        url: 'https://api.eu.mailgun.net',
      });
      this.domain = mailgunDomain;
    }
  }

  private renderTemplate(templateName: string, data: any): EmailTemplate {
    const textTemplatePath = join(this.templatesPath, `${templateName}.hbs`);
    const htmlTemplatePath = join(this.templatesPath, `${templateName}.html.hbs`);

    const textContent = readFileSync(textTemplatePath, 'utf-8');
    const htmlContent = readFileSync(htmlTemplatePath, 'utf-8');

    // Extract subject from text template
    const lines = textContent.split('\n');
    const subjectLine = lines.find((line) => line.startsWith('subject:'));
    const subject = subjectLine ? subjectLine.replace('subject:', '').trim() : 'AppGrid License';

    // Remove subject and separator from text content
    const textBody = lines
      .slice(lines.findIndex((line) => line === '---') + 1)
      .join('\n')
      .trim();

    const textTemplate = Handlebars.compile(textBody);
    const htmlTemplate = Handlebars.compile(htmlContent);
    const subjectTemplate = Handlebars.compile(subject);

    return {
      subject: subjectTemplate(data),
      text: textTemplate(data),
      html: htmlTemplate(data),
    };
  }

  async sendMigrationLicenseEmail(
    to: string,
    data: MigrationLicenseData
  ): Promise<{ success: boolean; messageId?: string; error?: string }> {
    if (!this.mg || !this.domain) {
      return {
        success: false,
        error: 'Mailgun not configured',
      };
    }

    try {
      const template = this.renderTemplate('migration-license', data);

      const messageData = {
        from: 'AppGrid <info@zekalogic.com>',
        to: [to],
        subject: template.subject,
        text: template.text,
        html: template.html,
      };

      const result = await this.mg.messages.create(this.domain, messageData);

      return {
        success: true,
        messageId: result.id,
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message,
      };
    }
  }

  async sendPaddleLicenseEmail(
    to: string,
    data: MigrationLicenseData
  ): Promise<{ success: boolean; messageId?: string; error?: string }> {
    if (!this.mg || !this.domain) {
      return {
        success: false,
        error: 'Mailgun not configured',
      };
    }

    try {
      const template = this.renderTemplate('paddle-license', data);

      const messageData = {
        from: 'AppGrid <info@zekalogic.com>',
        to: [to],
        subject: template.subject,
        text: template.text,
        html: template.html,
      };

      const result = await this.mg.messages.create(this.domain, messageData);

      return {
        success: true,
        messageId: result.id,
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Send a raw email (used by email queue)
   */
  async sendRawEmail(
    to: string,
    subject: string,
    text: string,
    html: string
  ): Promise<{ success: boolean; messageId?: string; error?: string }> {
    if (!this.mg || !this.domain) {
      return {
        success: false,
        error: 'Mailgun not configured',
      };
    }

    try {
      const messageData = {
        from: 'AppGrid <info@zekalogic.com>',
        to: [to],
        subject,
        text,
        html,
      };

      const result = await this.mg.messages.create(this.domain, messageData);

      return {
        success: true,
        messageId: result.id,
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Render a template and return the rendered content
   */
  renderTemplateForQueue(templateName: string, data: any): { subject: string; text: string; html: string } {
    return this.renderTemplate(templateName, data);
  }

  /**
   * Send an alert email to admin about system issues
   */
  async sendAlertEmail(
    subject: string,
    message: string,
    context?: Record<string, any>
  ): Promise<{ success: boolean; messageId?: string; error?: string }> {
    const alertEmail = process.env.ALERT_EMAIL || 'attila.miklosi@gmail.com';

    if (!this.mg || !this.domain) {
      console.error('Mailgun not configured - cannot send alert email');
      return {
        success: false,
        error: 'Mailgun not configured',
      };
    }

    try {
      const contextText = context
        ? '\n\nContext:\n' + JSON.stringify(context, null, 2)
        : '';

      const text = `${message}${contextText}`;
      const html = `
        <h2>⚠️ System Alert</h2>
        <p>${message.replace(/\n/g, '<br>')}</p>
        ${
          context
            ? `<h3>Context:</h3><pre>${JSON.stringify(context, null, 2)}</pre>`
            : ''
        }
      `;

      const messageData = {
        from: 'AppGrid Alerts <alerts@zekalogic.com>',
        to: [alertEmail],
        subject: `🚨 AppGrid Alert: ${subject}`,
        text,
        html,
      };

      const result = await this.mg.messages.create(this.domain, messageData);

      return {
        success: true,
        messageId: result.id,
      };
    } catch (error: any) {
      console.error('Failed to send alert email:', error);
      return {
        success: false,
        error: error.message,
      };
    }
  }
}

export const emailService = new EmailService();
