export interface RevenueCatWebhookPayload {
  api_version: string;
  event: {
    // Common fields (always present)
    type: 'INITIAL_PURCHASE' | 'RENEWAL' | 'CANCELLATION' | 'UNCANCELLATION' | 'NON_RENEWING_PURCHASE' | 'EXPIRATION' | 'BILLING_ISSUE' | 'PRODUCT_CHANGE';
    id: string;
    app_id: string;
    event_timestamp_ms: number;
    app_user_id: string;
    original_app_user_id: string;
    aliases: string[];
    subscriber_attributes: Record<string, any>;

    // Subscription lifecycle fields (present for most events)
    product_id: string;
    entitlement_ids: string[];
    period_type: 'NORMAL' | 'TRIAL' | 'INTRO';
    purchased_at_ms: number;
    expiration_at_ms: number | null;
    store: 'APP_STORE' | 'MAC_APP_STORE' | 'PLAY_STORE' | 'STRIPE' | 'PROMOTIONAL';
    environment: 'SANDBOX' | 'PRODUCTION';
    price: number;
    currency: string;
    transaction_id: string;

    // Conditional fields (may not be present in all events)
    cancel_reason?: string;
    expiration_reason?: string;
    new_product_id?: string;
    country_code?: string;

    // Legacy/additional fields (may be present)
    original_transaction_id?: string;
    entitlement_id?: string | null;
    is_family_share?: boolean;
    offer_code?: string | null;
    presented_offering_id?: string | null;
    price_in_purchased_currency?: number;
    takehome_percentage?: number;
    tax_percentage?: number;
  };
}