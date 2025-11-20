/**
 * Configuration validator to check required environment variables at startup
 */

interface ConfigValidation {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

interface RequiredConfig {
  name: string;
  description: string;
  required: boolean;
}

const CONFIG_REQUIREMENTS: RequiredConfig[] = [
  // Database
  { name: 'DATABASE_URL', description: 'Database connection URL', required: true },

  // Paddle (critical for webhooks)
  { name: 'PADDLE_WEBHOOK_SECRET', description: 'Paddle webhook signature verification', required: true },
  { name: 'PADDLE_API_KEY', description: 'Paddle API access', required: true },

  // Mailgun (email delivery)
  { name: 'MAILGUN_API_KEY', description: 'Mailgun email service', required: false },
  { name: 'MAILGUN_DOMAIN', description: 'Mailgun sending domain', required: false },

  // RevenueCat (for migrations)
  { name: 'REVENUECAT_API_KEY', description: 'RevenueCat API access', required: false },
  { name: 'REVENUECAT_PROJECT_ID', description: 'RevenueCat project identifier', required: false },
];

export class ConfigValidator {
  /**
   * Validate all required configuration at startup
   */
  static validate(): ConfigValidation {
    const errors: string[] = [];
    const warnings: string[] = [];

    for (const config of CONFIG_REQUIREMENTS) {
      const value = process.env[config.name];

      if (!value || value.trim() === '') {
        if (config.required) {
          errors.push(`Missing required config: ${config.name} (${config.description})`);
        } else {
          warnings.push(`Missing optional config: ${config.name} (${config.description})`);
        }
      }
    }

    // Validate Mailgun is fully configured or not at all
    const hasMailgunKey = process.env.MAILGUN_API_KEY;
    const hasMailgunDomain = process.env.MAILGUN_DOMAIN;

    if ((hasMailgunKey && !hasMailgunDomain) || (!hasMailgunKey && hasMailgunDomain)) {
      warnings.push('Mailgun partially configured - both MAILGUN_API_KEY and MAILGUN_DOMAIN are required for email delivery');
    }

    // Validate RevenueCat is fully configured or not at all
    const hasRevenueCatKey = process.env.REVENUECAT_API_KEY;
    const hasRevenueCatProject = process.env.REVENUECAT_PROJECT_ID;

    if ((hasRevenueCatKey && !hasRevenueCatProject) || (!hasRevenueCatKey && hasRevenueCatProject)) {
      warnings.push(
        'RevenueCat partially configured - both REVENUECAT_API_KEY and REVENUECAT_PROJECT_ID are required for migrations'
      );
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  }

  /**
   * Log validation results
   */
  static logValidation(logger: any) {
    const result = this.validate();

    if (result.valid) {
      logger.info('Configuration validation passed');

      if (result.warnings.length > 0) {
        logger.warn({ warnings: result.warnings }, 'Configuration warnings');
      }
    } else {
      logger.error({ errors: result.errors, warnings: result.warnings }, 'Configuration validation failed');
    }

    return result;
  }

  /**
   * Throw error if configuration is invalid
   */
  static validateOrThrow() {
    const result = this.validate();

    if (!result.valid) {
      const errorMessage = ['Configuration validation failed:', ...result.errors].join('\n  - ');
      throw new Error(errorMessage);
    }

    return result;
  }
}
