/**
 * Verifies RevenueCat webhook authorization header
 * @param authHeader - Authorization header value from the request
 * @param expectedToken - Expected authorization token from RevenueCat dashboard
 * @returns boolean indicating if authorization is valid
 */
export function verifyRevenueCatAuthorization(
  authHeader: string | undefined,
  expectedToken: string
): boolean {
  if (!authHeader || !expectedToken) {
    return false;
  }

  // RevenueCat sends the token directly in the Authorization header
  // Some implementations might use "Bearer <token>" format, handle both
  const token = authHeader.startsWith('Bearer ') 
    ? authHeader.substring(7) 
    : authHeader;

  return token === expectedToken;
}

/**
 * Middleware to verify RevenueCat webhook authorization
 */
export function createWebhookVerificationMiddleware(authToken?: string) {
  return (req: any, res: any, next: any) => {
    // Skip verification if no auth token is provided (for testing)
    if (!authToken) {
      console.warn('⚠️  Webhook authorization verification disabled (no auth token provided)');
      return next();
    }

    const authHeader = req.headers['authorization'];

    if (!verifyRevenueCatAuthorization(authHeader, authToken)) {
      console.error('❌ Invalid webhook authorization');
      console.error(`Expected: ${authToken}`);
      console.error(`Received: ${authHeader || 'none'}`);
      return res.status(401).json({ error: 'Unauthorized' });
    }

    console.log('✅ Webhook authorization verified');
    next();
  };
}