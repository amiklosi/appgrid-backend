import { PostHog } from 'posthog-node';

let _client: PostHog | null = null;

function getClient(): PostHog | null {
  if (_client) return _client;

  const apiKey = process.env.POSTHOG_API_KEY;
  if (!apiKey) return null;

  _client = new PostHog(apiKey, {
    host: 'https://eu.i.posthog.com',
    flushAt: 1,
    flushInterval: 0,
  });

  return _client;
}

export const analytics = {
  track(distinctId: string, event: string, properties?: Record<string, any>) {
    const client = getClient();
    if (!client) return;
    client.capture({ distinctId, event, properties });
  },

  async shutdown() {
    if (_client) {
      await _client.shutdown();
    }
  },
};
