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
  trial: { daily: 5, lifetime: 20 },
  pro:   { daily: 30, lifetime: 500 },
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

export async function checkAndIncrementUsage(
  licenseKey: string,
  machineId: string
): Promise<UsageCheckResult> {
  // Find the device activation with its license
  const activation = await prisma.deviceActivation.findFirst({
    where: {
      deviceFingerprint: machineId,
      license: { licenseKey },
    },
    include: { license: { select: { isTrial: true } } },
  });

  if (!activation) {
    // No activation found — don't block, just allow (license validation is separate)
    return { allowed: true };
  }

  const limits = activation.license.isTrial ? AI_LIMITS.trial : AI_LIMITS.pro;
  const now = new Date();

  // Resolve daily count (reset if past midnight since last reset)
  const resetAt = activation.aiDailyResetAt;
  const isNewDay = !resetAt || resetAt.toDateString() !== now.toDateString();
  const dailyCount = isNewDay ? 0 : activation.aiDailyCount;

  // Check lifetime limit
  if (activation.aiLifetimeCount >= limits.lifetime) {
    const isTrial = activation.license.isTrial;
    return {
      allowed: false,
      limitType: 'lifetime',
      reason: isTrial
        ? `You've used all your trial AI requests. Upgrade to Pro for more.`
        : `You've used all ${limits.lifetime} AI requests included with your license. Additional credit packs will be available soon — stay tuned!`,
    };
  }

  // Check daily limit
  if (dailyCount >= limits.daily) {
    return {
      allowed: false,
      limitType: 'daily',
      reason: `Daily limit of ${limits.daily} AI requests reached. Resets tomorrow.`,
    };
  }

  // Increment counters
  await prisma.deviceActivation.update({
    where: { id: activation.id },
    data: {
      aiDailyCount:    isNewDay ? 1 : { increment: 1 },
      aiDailyResetAt:  isNewDay ? now : undefined,
      aiLifetimeCount: { increment: 1 },
    },
  });

  return { allowed: true };
}
