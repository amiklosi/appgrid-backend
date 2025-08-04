import { RevenueCatWebhookPayload } from '../types/revenuecat';
import { UserModel, ProductModel, PurchaseModel, SubscriptionModel, WebhookEventModel } from '../db/models';

export class RevenueCatProcessor {
  static async processWebhook(webhookData: RevenueCatWebhookPayload): Promise<void> {
    const { event } = webhookData;
    
    console.log(`🔄 Processing ${event.type} event for user ${event.app_user_id}`);

    try {
      // 1. Create or update user
      const user = await UserModel.findOrCreate({
        app_user_id: event.app_user_id,
        original_app_user_id: event.original_app_user_id,
        aliases: event.aliases,
        environment: event.environment,
        country_code: event.country_code,
        subscriber_attributes: event.subscriber_attributes
      });

      console.log(`👤 User ${user.app_user_id} (${user.id}) processed`);

      // 2. Create or update product
      const product = await ProductModel.findOrCreate({
        product_id: event.product_id,
        store: event.store
      });

      console.log(`📦 Product ${product.product_id} (${product.id}) processed`);

      // 3. Check if we've already processed this event
      const existingPurchase = await PurchaseModel.findByEventId(event.id);
      if (existingPurchase) {
        console.log(`⚠️  Event ${event.id} already processed, skipping`);
        return;
      }

      // 4. Create purchase/event record
      const purchase = await PurchaseModel.create({
        user_id: user.id,
        product_id: product.id,
        revenuecat_event_id: event.id,
        event_type: event.type,
        transaction_id: event.transaction_id,
        original_transaction_id: event.original_transaction_id,
        price: event.price,
        currency: event.currency,
        price_in_purchased_currency: event.price_in_purchased_currency,
        takehome_percentage: event.takehome_percentage,
        tax_percentage: event.tax_percentage,
        period_type: event.period_type,
        entitlement_ids: event.entitlement_ids,
        entitlement_id: event.entitlement_id || undefined,
        purchased_at: new Date(event.purchased_at_ms),
        expiration_at: event.expiration_at_ms ? new Date(event.expiration_at_ms) : undefined,
        event_timestamp: new Date(event.event_timestamp_ms),
        is_family_share: event.is_family_share,
        offer_code: event.offer_code || undefined,
        presented_offering_id: event.presented_offering_id || undefined,
        raw_webhook_data: webhookData
      });

      console.log(`💰 Purchase ${purchase.id} created for event ${event.type}`);

      // 5. Update subscription status based on event type
      await this.updateSubscriptionStatus(user.id, product.id, event);

      // 6. Log successful processing
      await WebhookEventModel.create({
        event_type: event.type,
        revenuecat_event_id: event.id,
        app_user_id: event.app_user_id,
        processed_successfully: true,
        raw_payload: webhookData
      });

      console.log(`✅ Successfully processed ${event.type} event for ${event.app_user_id}`);

    } catch (error) {
      console.error(`❌ Error processing webhook:`, error);
      
      // Log failed processing
      await WebhookEventModel.create({
        event_type: event.type,
        revenuecat_event_id: event.id,
        app_user_id: event.app_user_id,
        processed_successfully: false,
        error_message: error instanceof Error ? error.message : 'Unknown error',
        raw_payload: webhookData
      });

      throw error;
    }
  }

  private static async updateSubscriptionStatus(
    userId: string, 
    productId: string, 
    event: RevenueCatWebhookPayload['event']
  ): Promise<void> {
    if (!event.original_transaction_id) {
      console.log('⚠️  No original_transaction_id, skipping subscription update');
      return;
    }

    let status: string;
    let cancelledAt: Date | undefined;
    let expiresAt: Date | undefined;

    // Determine subscription status based on event type
    switch (event.type) {
      case 'INITIAL_PURCHASE':
      case 'RENEWAL':
      case 'UNCANCELLATION':
        status = 'active';
        expiresAt = event.expiration_at_ms ? new Date(event.expiration_at_ms) : undefined;
        cancelledAt = undefined;
        break;
      
      case 'CANCELLATION':
        status = 'cancelled';
        cancelledAt = new Date(event.event_timestamp_ms);
        expiresAt = event.expiration_at_ms ? new Date(event.expiration_at_ms) : undefined;
        break;
      
      case 'EXPIRATION':
        status = 'expired';
        expiresAt = new Date(event.event_timestamp_ms);
        break;
      
      case 'BILLING_ISSUE':
        status = 'billing_issue';
        break;
      
      case 'PRODUCT_CHANGE':
        status = 'active';
        expiresAt = event.expiration_at_ms ? new Date(event.expiration_at_ms) : undefined;
        break;
      
      default:
        console.log(`⚠️  Unknown event type ${event.type}, setting status to 'unknown'`);
        status = 'unknown';
    }

    await SubscriptionModel.upsert({
      user_id: userId,
      product_id: productId,
      status,
      original_transaction_id: event.original_transaction_id,
      latest_transaction_id: event.transaction_id,
      started_at: new Date(event.purchased_at_ms),
      expires_at: expiresAt,
      cancelled_at: cancelledAt,
      entitlement_ids: event.entitlement_ids
    });

    console.log(`🔄 Subscription ${event.original_transaction_id} updated to status: ${status}`);
  }
}