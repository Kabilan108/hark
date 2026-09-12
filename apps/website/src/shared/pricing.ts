import type { PricingPlansDto } from "@hark/contracts";

export const FREE_NOTIFICATIONS = 10_000;
export const PRO_NOTIFICATIONS = 100_000;
export const PRO_PRICE_MONTHLY = 8;

interface PricingRateLimits {
  freeServicePerMinute: number;
  freeAccountPerMinute: number;
  proServicePerMinute: number;
  proAccountPerMinute: number;
}

const defaultRateLimits: PricingRateLimits = {
  freeServicePerMinute: 60,
  freeAccountPerMinute: 300,
  proServicePerMinute: 300,
  proAccountPerMinute: 1_500,
};

/** Public fallback catalog, also used as the prerendered pricing-page state. */
export function staticPricingPlans(limits: PricingRateLimits = defaultRateLimits): PricingPlansDto {
  return {
    source: "static",
    plans: [
      {
        id: "self_hosted",
        name: "Self-hosted",
        description: "Every Hark feature, running on your own infrastructure.",
        priceMonthly: 0,
        notificationsPerMonth: null,
        devices: null,
        deviceRouting: true,
        servicePerMinute: limits.proServicePerMinute,
        accountPerMinute: limits.proAccountPerMinute,
      },
    ],
  };
}
