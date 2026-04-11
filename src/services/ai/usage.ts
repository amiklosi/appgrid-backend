/**
 * AI usage tracking and rate limiting.
 *
 * Limits are per (licenseKey, machineId) — i.e. per device activation.
 * Trial and pro licenses have different limits.
 */

import { prisma } from '../../lib/prisma';

// ---------------------------------------------------------------------------
// Limits
// ---------------------------------------------------------------------------

export const AI_LIMITS = {
  trial: { daily: 10, lifetime: 30 },
  pro: { daily: 30, lifetime: 500 },
} as const;

export type UsageCheckResult =
  | { allowed: true }
  | { allowed: false; reason: string; limitType: 'daily' | 'lifetime' };

// ---------------------------------------------------------------------------
// checkAndIncrementUsage
//
// Looks up the DeviceActivation for (licenseKey, machineId), checks limits,
// and increments counters atomically if allowed.
// ---------------------------------------------------------------------------

const UNLIMITED_LICENSE_KEYS = ['DEBUG-PRO-KEY'];

export async function checkAndIncrementUsage(
  licenseKey: string,
  machineId: string
): Promise<UsageCheckResult> {
  if (process.env.NODE_ENV === 'development' && UNLIMITED_LICENSE_KEYS.includes(licenseKey)) {
    return { allowed: true };
  }
  // Wrap in a transaction so the read-then-write is atomic — prevents two
  // concurrent requests both passing the limit check before either increments.
  return prisma.$transaction(async (tx) => {
    // Find the device activation with its license
    const activation = await tx.deviceActivation.findFirst({
      where: {
        deviceFingerprint: machineId,
        license: { licenseKey },
      },
      include: { license: { select: { isTrial: true } } },
    });

    if (!activation) {
      // No activation found — block the request. A fabricated or unrecognised
      // (licenseKey, machineId) pair would otherwise bypass all rate limits.
      return {
        allowed: false,
        limitType: 'lifetime' as const,
        reason: 'Device not recognised. Please activate your license on this device first.',
      };
    }

    const limits = activation.license.isTrial ? AI_LIMITS.trial : AI_LIMITS.pro;
    const now = new Date();

    // Resolve daily count (reset if past midnight UTC)
    const resetAt = activation.aiDailyResetAt;
    const todayUtc = now.toISOString().slice(0, 10);
    const resetDay = resetAt?.toISOString().slice(0, 10) ?? '';
    const isNewDay = resetDay !== todayUtc;
    const dailyCount = isNewDay ? 0 : activation.aiDailyCount;

    // Check lifetime limit
    if (activation.aiLifetimeCount >= limits.lifetime) {
      const isTrial = activation.license.isTrial;
      return {
        allowed: false,
        limitType: 'lifetime' as const,
        reason: isTrial
          ? `You've used all your trial AI requests. Upgrade to Pro for more.`
          : `You've used all ${limits.lifetime} AI requests included with your license. Additional credit packs will be available soon — stay tuned!`,
      };
    }

    // Check daily limit
    if (dailyCount >= limits.daily) {
      return {
        allowed: false,
        limitType: 'daily' as const,
        reason: `Daily limit of ${limits.daily} AI requests reached. Resets tomorrow.`,
      };
    }

    // Increment counters
    await tx.deviceActivation.update({
      where: { id: activation.id },
      data: {
        aiDailyCount: isNewDay ? 1 : { increment: 1 },
        aiDailyResetAt: isNewDay ? now : undefined,
        aiLifetimeCount: { increment: 1 },
      },
    });

    return { allowed: true };
  });
}
