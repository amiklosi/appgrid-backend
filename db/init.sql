-- RevenueCat Database Schema
-- This script runs when the PostgreSQL container starts

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Users table to track app users
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    app_user_id VARCHAR(255) UNIQUE NOT NULL,
    original_app_user_id VARCHAR(255),
    aliases TEXT[], -- Array of user aliases
    environment VARCHAR(50) NOT NULL, -- SANDBOX or PRODUCTION
    country_code VARCHAR(2),
    subscriber_attributes JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Products table to track available products
CREATE TABLE products (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    product_id VARCHAR(255) UNIQUE NOT NULL,
    store VARCHAR(50) NOT NULL, -- APP_STORE, PLAY_STORE, etc.
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Purchases/Events table to track all RevenueCat events
CREATE TABLE purchases (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id),
    product_id UUID REFERENCES products(id),
    
    -- RevenueCat event data
    revenuecat_event_id VARCHAR(255) UNIQUE NOT NULL,
    event_type VARCHAR(50) NOT NULL, -- INITIAL_PURCHASE, RENEWAL, etc.
    transaction_id VARCHAR(255),
    original_transaction_id VARCHAR(255),
    
    -- Financial data
    price DECIMAL(10,2),
    currency VARCHAR(3),
    price_in_purchased_currency DECIMAL(10,2),
    takehome_percentage DECIMAL(5,2),
    tax_percentage DECIMAL(5,2),
    
    -- Subscription data
    period_type VARCHAR(20), -- NORMAL, TRIAL, INTRO
    entitlement_ids TEXT[],
    entitlement_id VARCHAR(255),
    
    -- Timing data
    purchased_at TIMESTAMP WITH TIME ZONE,
    expiration_at TIMESTAMP WITH TIME ZONE,
    event_timestamp TIMESTAMP WITH TIME ZONE,
    
    -- Additional data
    is_family_share BOOLEAN DEFAULT FALSE,
    offer_code VARCHAR(255),
    presented_offering_id VARCHAR(255),
    
    -- Metadata
    raw_webhook_data JSONB, -- Store complete webhook payload
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Subscriptions table to track current subscription states
CREATE TABLE subscriptions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id),
    product_id UUID REFERENCES products(id),
    
    -- Subscription status
    status VARCHAR(50) NOT NULL, -- active, expired, cancelled, etc.
    
    -- Key identifiers
    original_transaction_id VARCHAR(255) UNIQUE NOT NULL,
    latest_transaction_id VARCHAR(255),
    
    -- Timing
    started_at TIMESTAMP WITH TIME ZONE,
    expires_at TIMESTAMP WITH TIME ZONE,
    cancelled_at TIMESTAMP WITH TIME ZONE,
    
    -- Entitlements
    entitlement_ids TEXT[],
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Webhook events log for debugging and audit
CREATE TABLE webhook_events (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    event_type VARCHAR(50),
    revenuecat_event_id VARCHAR(255),
    app_user_id VARCHAR(255),
    processed_successfully BOOLEAN DEFAULT FALSE,
    error_message TEXT,
    raw_payload JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for better performance
CREATE INDEX idx_users_app_user_id ON users(app_user_id);
CREATE INDEX idx_users_environment ON users(environment);
CREATE INDEX idx_products_product_id ON products(product_id);
CREATE INDEX idx_purchases_user_id ON purchases(user_id);
CREATE INDEX idx_purchases_event_type ON purchases(event_type);
CREATE INDEX idx_purchases_transaction_id ON purchases(transaction_id);
CREATE INDEX idx_purchases_event_timestamp ON purchases(event_timestamp);
CREATE INDEX idx_subscriptions_user_id ON subscriptions(user_id);
CREATE INDEX idx_subscriptions_status ON subscriptions(status);
CREATE INDEX idx_subscriptions_original_transaction_id ON subscriptions(original_transaction_id);
CREATE INDEX idx_webhook_events_created_at ON webhook_events(created_at);
CREATE INDEX idx_webhook_events_processed ON webhook_events(processed_successfully);

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Triggers to automatically update updated_at
CREATE TRIGGER update_users_updated_at 
    BEFORE UPDATE ON users 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_subscriptions_updated_at 
    BEFORE UPDATE ON subscriptions 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Sample data for testing (optional)
-- INSERT INTO products (product_id, store) VALUES 
-- ('com.example.premium_monthly', 'APP_STORE'),
-- ('com.example.premium_yearly', 'APP_STORE');

-- Grant permissions
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO appgrid_user;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO appgrid_user;