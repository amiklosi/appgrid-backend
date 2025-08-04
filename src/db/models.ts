import pool from './connection';
import { RevenueCatWebhookPayload } from '../types/revenuecat';

export interface User {
  id: string;
  app_user_id: string;
  original_app_user_id?: string;
  aliases?: string[];
  environment: 'SANDBOX' | 'PRODUCTION';
  country_code?: string;
  subscriber_attributes?: Record<string, any>;
  created_at: Date;
  updated_at: Date;
}

export interface Product {
  id: string;
  product_id: string;
  store: string;
  created_at: Date;
}

export interface Purchase {
  id: string;
  user_id: string;
  product_id: string;
  revenuecat_event_id: string;
  event_type: string;
  transaction_id?: string;
  original_transaction_id?: string;
  price?: number;
  currency?: string;
  price_in_purchased_currency?: number;
  takehome_percentage?: number;
  tax_percentage?: number;
  period_type?: string;
  entitlement_ids?: string[];
  entitlement_id?: string;
  purchased_at?: Date;
  expiration_at?: Date;
  event_timestamp?: Date;
  is_family_share?: boolean;
  offer_code?: string;
  presented_offering_id?: string;
  raw_webhook_data?: any;
  created_at: Date;
}

export interface Subscription {
  id: string;
  user_id: string;
  product_id: string;
  status: string;
  original_transaction_id: string;
  latest_transaction_id?: string;
  started_at?: Date;
  expires_at?: Date;
  cancelled_at?: Date;
  entitlement_ids?: string[];
  created_at: Date;
  updated_at: Date;
}

export interface WebhookEvent {
  id: string;
  event_type?: string;
  revenuecat_event_id?: string;
  app_user_id?: string;
  processed_successfully: boolean;
  error_message?: string;
  raw_payload: any;
  created_at: Date;
}

export class UserModel {
  static async findOrCreate(userData: {
    app_user_id: string;
    original_app_user_id?: string;
    aliases?: string[];
    environment: 'SANDBOX' | 'PRODUCTION';
    country_code?: string;
    subscriber_attributes?: Record<string, any>;
  }): Promise<User> {
    const client = await pool.connect();
    try {
      // Try to find existing user
      let result = await client.query(
        'SELECT * FROM users WHERE app_user_id = $1',
        [userData.app_user_id]
      );

      if (result.rows.length > 0) {
        // Update existing user
        const updateResult = await client.query(`
          UPDATE users 
          SET original_app_user_id = COALESCE($2, original_app_user_id),
              aliases = COALESCE($3, aliases),
              environment = $4,
              country_code = COALESCE($5, country_code),
              subscriber_attributes = COALESCE($6, subscriber_attributes),
              updated_at = CURRENT_TIMESTAMP
          WHERE app_user_id = $1
          RETURNING *
        `, [
          userData.app_user_id,
          userData.original_app_user_id,
          userData.aliases,
          userData.environment,
          userData.country_code,
          userData.subscriber_attributes ? JSON.stringify(userData.subscriber_attributes) : null
        ]);
        return updateResult.rows[0];
      } else {
        // Create new user
        const insertResult = await client.query(`
          INSERT INTO users (app_user_id, original_app_user_id, aliases, environment, country_code, subscriber_attributes)
          VALUES ($1, $2, $3, $4, $5, $6)
          RETURNING *
        `, [
          userData.app_user_id,
          userData.original_app_user_id,
          userData.aliases,
          userData.environment,
          userData.country_code,
          userData.subscriber_attributes ? JSON.stringify(userData.subscriber_attributes) : null
        ]);
        return insertResult.rows[0];
      }
    } finally {
      client.release();
    }
  }

  static async findByAppUserId(app_user_id: string): Promise<User | null> {
    const result = await pool.query('SELECT * FROM users WHERE app_user_id = $1', [app_user_id]);
    return result.rows[0] || null;
  }
}

export class ProductModel {
  static async findOrCreate(productData: {
    product_id: string;
    store: string;
  }): Promise<Product> {
    const client = await pool.connect();
    try {
      // Try to find existing product
      let result = await client.query(
        'SELECT * FROM products WHERE product_id = $1',
        [productData.product_id]
      );

      if (result.rows.length > 0) {
        return result.rows[0];
      } else {
        // Create new product
        const insertResult = await client.query(`
          INSERT INTO products (product_id, store)
          VALUES ($1, $2)
          RETURNING *
        `, [productData.product_id, productData.store]);
        return insertResult.rows[0];
      }
    } finally {
      client.release();
    }
  }
}

export class PurchaseModel {
  static async create(purchaseData: {
    user_id: string;
    product_id: string;
    revenuecat_event_id: string;
    event_type: string;
    transaction_id?: string;
    original_transaction_id?: string;
    price?: number;
    currency?: string;
    price_in_purchased_currency?: number;
    takehome_percentage?: number;
    tax_percentage?: number;
    period_type?: string;
    entitlement_ids?: string[];
    entitlement_id?: string;
    purchased_at?: Date;
    expiration_at?: Date;
    event_timestamp?: Date;
    is_family_share?: boolean;
    offer_code?: string;
    presented_offering_id?: string;
    raw_webhook_data?: any;
  }): Promise<Purchase> {
    const result = await pool.query(`
      INSERT INTO purchases (
        user_id, product_id, revenuecat_event_id, event_type, transaction_id, 
        original_transaction_id, price, currency, price_in_purchased_currency,
        takehome_percentage, tax_percentage, period_type, entitlement_ids,
        entitlement_id, purchased_at, expiration_at, event_timestamp,
        is_family_share, offer_code, presented_offering_id, raw_webhook_data
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21)
      RETURNING *
    `, [
      purchaseData.user_id,
      purchaseData.product_id,
      purchaseData.revenuecat_event_id,
      purchaseData.event_type,
      purchaseData.transaction_id,
      purchaseData.original_transaction_id,
      purchaseData.price,
      purchaseData.currency,
      purchaseData.price_in_purchased_currency,
      purchaseData.takehome_percentage,
      purchaseData.tax_percentage,
      purchaseData.period_type,
      purchaseData.entitlement_ids,
      purchaseData.entitlement_id,
      purchaseData.purchased_at,
      purchaseData.expiration_at,
      purchaseData.event_timestamp,
      purchaseData.is_family_share,
      purchaseData.offer_code,
      purchaseData.presented_offering_id,
      purchaseData.raw_webhook_data ? JSON.stringify(purchaseData.raw_webhook_data) : null
    ]);
    return result.rows[0];
  }

  static async findByEventId(revenuecat_event_id: string): Promise<Purchase | null> {
    const result = await pool.query('SELECT * FROM purchases WHERE revenuecat_event_id = $1', [revenuecat_event_id]);
    return result.rows[0] || null;
  }
}

export class SubscriptionModel {
  static async upsert(subscriptionData: {
    user_id: string;
    product_id: string;
    status: string;
    original_transaction_id: string;
    latest_transaction_id?: string;
    started_at?: Date;
    expires_at?: Date;
    cancelled_at?: Date;
    entitlement_ids?: string[];
  }): Promise<Subscription> {
    const client = await pool.connect();
    try {
      const result = await client.query(`
        INSERT INTO subscriptions (
          user_id, product_id, status, original_transaction_id, 
          latest_transaction_id, started_at, expires_at, cancelled_at, entitlement_ids
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        ON CONFLICT (original_transaction_id) 
        DO UPDATE SET
          status = EXCLUDED.status,
          latest_transaction_id = EXCLUDED.latest_transaction_id,
          expires_at = EXCLUDED.expires_at,
          cancelled_at = EXCLUDED.cancelled_at,
          entitlement_ids = EXCLUDED.entitlement_ids,
          updated_at = CURRENT_TIMESTAMP
        RETURNING *
      `, [
        subscriptionData.user_id,
        subscriptionData.product_id,
        subscriptionData.status,
        subscriptionData.original_transaction_id,
        subscriptionData.latest_transaction_id,
        subscriptionData.started_at,
        subscriptionData.expires_at,
        subscriptionData.cancelled_at,
        subscriptionData.entitlement_ids
      ]);
      return result.rows[0];
    } finally {
      client.release();
    }
  }
}

export class WebhookEventModel {
  static async create(eventData: {
    event_type?: string;
    revenuecat_event_id?: string;
    app_user_id?: string;
    processed_successfully: boolean;
    error_message?: string;
    raw_payload: any;
  }): Promise<WebhookEvent> {
    const result = await pool.query(`
      INSERT INTO webhook_events (event_type, revenuecat_event_id, app_user_id, processed_successfully, error_message, raw_payload)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *
    `, [
      eventData.event_type,
      eventData.revenuecat_event_id,
      eventData.app_user_id,
      eventData.processed_successfully,
      eventData.error_message,
      JSON.stringify(eventData.raw_payload)
    ]);
    return result.rows[0];
  }
}