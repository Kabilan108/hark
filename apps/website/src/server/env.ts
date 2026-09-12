import { z } from "zod";

const DEV_SECRET = "hark-insecure-dev-secret-change-me";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  HOST: z.string().trim().min(1).default("127.0.0.1"),
  PORT: z.coerce.number().int().positive().default(8787),
  /** SQLite file path. Production containers should point this at /data/hark.sqlite. */
  DATABASE_URL: z.string().min(1).default("./data/hark.sqlite"),
  /** Public origin the browser uses. In dev this is the Vite server, which proxies /api. */
  APP_URL: z.url().default("http://localhost:5173"),
  BETTER_AUTH_SECRET: z.string().min(16).default(DEV_SECRET),
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  /** The only Google identity allowed to create a session on this private fork. */
  OWNER_EMAIL: z.email().trim().toLowerCase().optional(),
  /** Compatibility values for retained historical Apple modules, which are not mounted. */
  APPLE_SIGN_IN_SERVICE_ID: z.string().optional(),
  APPLE_SIGN_IN_BUNDLE_ID: z.string().min(1).default("ceo.ryan.hark"),
  APPLE_SIGN_IN_KEY_ID: z.string().optional(),
  APPLE_SIGN_IN_PRIVATE_KEY: z.string().optional(),
  /** Optional. Enables authenticated requests to the Expo Push Service. */
  EXPO_ACCESS_TOKEN: z.string().optional(),
  /** Firebase project and server-only service-account file used for direct FCM HTTP v1. */
  FCM_PROJECT_ID: z.string().trim().min(1).optional(),
  FCM_SERVICE_ACCOUNT_FILE: z.string().trim().min(1).optional(),
  /** Enables the full feature set without a hosted billing provider. */
  SELF_HOSTED_MODE: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
  /** Optional direct APNs credentials for Live Activity start/update/end delivery. */
  APNS_KEY_ID: z.string().optional(),
  APPLE_TEAM_ID: z.string().optional(),
  APNS_PRIVATE_KEY: z.string().optional(),
  APNS_BUNDLE_ID: z.string().min(1).default("ceo.ryan.hark"),
  APNS_ENVIRONMENT: z.enum(["sandbox", "production"]).default("sandbox"),
  /** Autumn production secret key. Kept server-side and never exposed to clients. */
  AUTUMN_API_KEY: z.string().optional(),
  /**
   * Header carrying the real client IP, set (and overwritten) by a trusted edge.
   * Leave unset when the edge does not provide one: client-supplied forwarded
   * headers are spoofable and would let a caller reset its own rate-limit bucket.
   */
  /** Empty means unset, matching how compose passes absent optional values. */
  TRUSTED_CLIENT_IP_HEADER: z.string().trim().optional(),
  SERVICE_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().positive().default(60),
  ACCOUNT_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().positive().default(300),
  PRO_SERVICE_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().positive().default(300),
  PRO_ACCOUNT_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().positive().default(1500),
});

const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
  console.error("Invalid environment configuration:");
  console.error(z.prettifyError(parsed.error));
  process.exit(1);
}

export const env = parsed.data;

/** Startup checks that warn (dev) or fail (production) without real credentials. */
export function assertRuntimeEnv(): void {
  const problems: string[] = [];
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) {
    problems.push(
      "GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET are not set — Google sign-in will fail until configured.",
    );
  }
  if (env.BETTER_AUTH_SECRET === DEV_SECRET) {
    problems.push("BETTER_AUTH_SECRET is using the insecure development default.");
  }
  if (!env.OWNER_EMAIL) {
    problems.push("OWNER_EMAIL is not set; Google sign-in has no allowed account.");
  }
  if (!env.FCM_PROJECT_ID || !env.FCM_SERVICE_ACCOUNT_FILE) {
    problems.push(
      "FCM_PROJECT_ID / FCM_SERVICE_ACCOUNT_FILE are not set; Android push delivery will be unavailable.",
    );
  }
  if (!env.AUTUMN_API_KEY && !env.SELF_HOSTED_MODE) {
    problems.push("AUTUMN_API_KEY is not set — paid plans and checkout will be unavailable.");
  }

  if (env.NODE_ENV === "production" && env.BETTER_AUTH_SECRET === DEV_SECRET) {
    console.error("Refusing to start in production with the default BETTER_AUTH_SECRET.");
    process.exit(1);
  }
  if (env.NODE_ENV === "production" && !env.OWNER_EMAIL) {
    console.error("Refusing to start in production without OWNER_EMAIL.");
    process.exit(1);
  }

  for (const p of problems) {
    console.warn(`[env] ${p}`);
  }
}
