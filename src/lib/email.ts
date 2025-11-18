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

  private loadTemplate(templateName: string): EmailTemplate {
    const textTemplatePath = join(this.templatesPath, `${templateName}.hbs`);
    const htmlTemplatePath = join(this.templatesPath, `${templateName}.html.hbs`);

    const textContent = readFileSync(textTemplatePath, 'utf-8');
    const htmlContent = readFileSync(htmlTemplatePath, 'utf-8');

    // Extract subject from text template (first line with "subject: ")
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
      subject: subjectTemplate({}),
      text: textTemplate({}),
      html: htmlTemplate({}),
    };
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
}

export const emailService = new EmailService();
