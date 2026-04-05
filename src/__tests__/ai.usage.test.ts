import { describe, it, expect, beforeEach, vi } from 'vitest';
import { checkAndIncrementUsage, AI_LIMITS } from '../services/ai/usage';
import { prismaMock } from './setup';

function makeActivation(overrides: object = {}) {
  return {
    id: 'act-1',
    licenseId: 'lic-1',
    deviceFingerprint: 'machine-abc',
    aiDailyCount: 0,
    aiDailyResetAt: null,
    aiLifetimeCount: 0,
    license: { isTrial: false },
    ...overrides,
  };
}

describe('checkAndIncrementUsage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // No activation found — allow through (license validation is separate)
  // -------------------------------------------------------------------------

  it('allows request when no device activation found', async () => {
    prismaMock.deviceActivation.findFirst.mockResolvedValue(null as any);
    const result = await checkAndIncrementUsage('key-123', 'machine-abc');
    expect(result.allowed).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Pro limits
  // -------------------------------------------------------------------------

  describe('pro license', () => {
    it('allows when under both limits', async () => {
      prismaMock.deviceActivation.findFirst.mockResolvedValue(
        makeActivation({ aiDailyCount: 5, aiLifetimeCount: 100 }) as any
      );
      prismaMock.deviceActivation.update.mockResolvedValue({} as any);

      const result = await checkAndIncrementUsage('key', 'machine');
      expect(result.allowed).toBe(true);
      expect(prismaMock.deviceActivation.update).toHaveBeenCalled();
    });

    it('blocks at daily limit', async () => {
      prismaMock.deviceActivation.findFirst.mockResolvedValue(
        makeActivation({
          aiDailyCount: AI_LIMITS.pro.daily,
          aiDailyResetAt: new Date(), // today
          aiLifetimeCount: 10,
        }) as any
      );

      const result = await checkAndIncrementUsage('key', 'machine');
      expect(result.allowed).toBe(false);
      if (!result.allowed) {
        expect(result.limitType).toBe('daily');
        expect(result.reason).toMatch(/daily limit/i);
      }
      expect(prismaMock.deviceActivation.update).not.toHaveBeenCalled();
    });

    it('blocks at lifetime limit', async () => {
      prismaMock.deviceActivation.findFirst.mockResolvedValue(
        makeActivation({
          aiDailyCount: 0,
          aiLifetimeCount: AI_LIMITS.pro.lifetime,
        }) as any
      );

      const result = await checkAndIncrementUsage('key', 'machine');
      expect(result.allowed).toBe(false);
      if (!result.allowed) {
        expect(result.limitType).toBe('lifetime');
        expect(result.reason).toMatch(/credit packs/i);
      }
    });

    it('lifetime check takes precedence over daily', async () => {
      prismaMock.deviceActivation.findFirst.mockResolvedValue(
        makeActivation({
          aiDailyCount: AI_LIMITS.pro.daily,
          aiDailyResetAt: new Date(),
          aiLifetimeCount: AI_LIMITS.pro.lifetime,
        }) as any
      );

      const result = await checkAndIncrementUsage('key', 'machine');
      expect(result.allowed).toBe(false);
      if (!result.allowed) expect(result.limitType).toBe('lifetime');
    });
  });

  // -------------------------------------------------------------------------
  // Trial limits
  // -------------------------------------------------------------------------

  describe('trial license', () => {
    it('blocks at trial daily limit', async () => {
      prismaMock.deviceActivation.findFirst.mockResolvedValue(
        makeActivation({
          aiDailyCount: AI_LIMITS.trial.daily,
          aiDailyResetAt: new Date(),
          aiLifetimeCount: 5,
          license: { isTrial: true },
        }) as any
      );

      const result = await checkAndIncrementUsage('key', 'machine');
      expect(result.allowed).toBe(false);
      if (!result.allowed) expect(result.limitType).toBe('daily');
    });

    it('blocks at trial lifetime limit', async () => {
      prismaMock.deviceActivation.findFirst.mockResolvedValue(
        makeActivation({
          aiDailyCount: 0,
          aiLifetimeCount: AI_LIMITS.trial.lifetime,
          license: { isTrial: true },
        }) as any
      );

      const result = await checkAndIncrementUsage('key', 'machine');
      expect(result.allowed).toBe(false);
      if (!result.allowed) expect(result.limitType).toBe('lifetime');
    });

    it('allows trial user under limits', async () => {
      prismaMock.deviceActivation.findFirst.mockResolvedValue(
        makeActivation({
          aiDailyCount: 2,
          aiDailyResetAt: new Date(),
          aiLifetimeCount: 10,
          license: { isTrial: true },
        }) as any
      );
      prismaMock.deviceActivation.update.mockResolvedValue({} as any);

      const result = await checkAndIncrementUsage('key', 'machine');
      expect(result.allowed).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // Daily reset
  // -------------------------------------------------------------------------

  describe('daily reset', () => {
    it('resets daily count when last reset was yesterday', async () => {
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);

      prismaMock.deviceActivation.findFirst.mockResolvedValue(
        makeActivation({
          aiDailyCount: AI_LIMITS.pro.daily, // would be blocked if not reset
          aiDailyResetAt: yesterday,
          aiLifetimeCount: 10,
        }) as any
      );
      prismaMock.deviceActivation.update.mockResolvedValue({} as any);

      const result = await checkAndIncrementUsage('key', 'machine');
      expect(result.allowed).toBe(true);

      // Should reset daily count to 1
      const updateCall = prismaMock.deviceActivation.update.mock.calls[0][0];
      expect(updateCall.data.aiDailyCount).toBe(1);
      expect(updateCall.data.aiDailyResetAt).toBeInstanceOf(Date);
    });

    it('does not reset if reset was today', async () => {
      const today = new Date();
      prismaMock.deviceActivation.findFirst.mockResolvedValue(
        makeActivation({
          aiDailyCount: 3,
          aiDailyResetAt: today,
          aiLifetimeCount: 10,
        }) as any
      );
      prismaMock.deviceActivation.update.mockResolvedValue({} as any);

      await checkAndIncrementUsage('key', 'machine');

      const updateCall = prismaMock.deviceActivation.update.mock.calls[0][0];
      expect(updateCall.data.aiDailyCount).toEqual({ increment: 1 });
    });
  });
});
