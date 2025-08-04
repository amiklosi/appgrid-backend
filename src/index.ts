import 'dotenv/config';
import express from 'express';
import { RevenueCatWebhookPayload } from './types/revenuecat';
import { createWebhookVerificationMiddleware } from './utils/webhook-verification';
import { RevenueCatProcessor } from './services/revenuecat-processor';

const app = express();
const PORT = process.env.PORT || 3000;
const REVENUECAT_AUTH_TOKEN = process.env.REVENUECAT_AUTH_TOKEN;

// Debug environment variables
console.log('🔧 Environment variables:');
console.log('PORT:', PORT);
console.log('REVENUECAT_AUTH_TOKEN:', REVENUECAT_AUTH_TOKEN ? '***' : 'NOT SET');

// Middleware to parse JSON with raw body for webhook verification
app.use('/webhook', express.raw({ type: 'application/json' }));
app.use(express.json());

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// RevenueCat webhook endpoint with authorization verification
app.post('/webhook/revenuecat', 
  createWebhookVerificationMiddleware(REVENUECAT_AUTH_TOKEN),
  async (req, res) => {
  try {
    console.log('📥 Received RevenueCat webhook');
    console.log('Headers:', JSON.stringify(req.headers, null, 2));
    
    // Parse the raw body
    const rawBody = req.body;
    const bodyString = rawBody.toString('utf8');
    
    console.log('Raw body:', bodyString);
    
    let webhookData: RevenueCatWebhookPayload;
    try {
      webhookData = JSON.parse(bodyString);
    } catch (parseError) {
      console.error('❌ Failed to parse webhook body:', parseError);
      return res.status(400).json({ error: 'Invalid JSON payload' });
    }
    
    console.log('📊 Webhook data:', JSON.stringify(webhookData, null, 2));
    
    // Log key event details
    if (webhookData.event) {
      const { event } = webhookData;
      console.log(`🎯 Event Type: ${event.type}`);
      console.log(`👤 User ID: ${event.app_user_id}`);
      console.log(`📦 Product ID: ${event.product_id}`);
      console.log(`💰 Price: ${event.price} ${event.currency}`);
      console.log(`🏪 Store: ${event.store}`);
      console.log(`🌍 Environment: ${event.environment}`);
      console.log(`📅 Event Time: ${new Date(event.event_timestamp_ms).toISOString()}`);
    }

    // Process webhook data and save to database
    try {
      await RevenueCatProcessor.processWebhook(webhookData);
      console.log('💾 Webhook data saved to database');
    } catch (dbError) {
      console.error('❌ Database processing failed:', dbError);
      // Still return 200 to prevent RevenueCat from retrying
      // The error is logged in webhook_events table
    }
    
    // Respond with 200 OK to acknowledge receipt
    res.status(200).json({ 
      received: true, 
      timestamp: new Date().toISOString(),
      eventType: webhookData.event?.type || 'unknown'
    });
    
  } catch (error) {
    console.error('❌ Error processing webhook:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 RevenueCat webhook server running on port ${PORT}`);
  console.log(`📍 Webhook endpoint: http://localhost:${PORT}/webhook/revenuecat`);
  console.log(`🏥 Health check: http://localhost:${PORT}/health`);
});