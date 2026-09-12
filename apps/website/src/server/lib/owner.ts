import { and, eq, ne, sql } from "drizzle-orm";
import { db } from "../db";
import { account, user } from "../db/schema";
import { env } from "../env";

export interface GoogleOwnerProfile {
  sub?: string;
  email?: string;
  email_verified?: boolean;
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** Test fixtures may omit the owner. Every running server must configure one. */
export function configuredOwnerEmail(): string | undefined {
  return env.OWNER_EMAIL;
}

/**
 * Accepts a Google profile only when its verified email belongs to this server's owner.
 * Once an owner has a Google account row, that provider subject is the permanent identity.
 */
export async function isAllowedGoogleOwnerProfile(
  profile: GoogleOwnerProfile,
  ownerEmail = configuredOwnerEmail(),
): Promise<boolean> {
  const subject = profile.sub?.trim();
  const email = profile.email ? normalizeEmail(profile.email) : "";
  if (!subject || !email || profile.email_verified !== true) return false;
  if (!ownerEmail) return env.NODE_ENV === "test";
  if (email !== normalizeEmail(ownerEmail)) return false;

  const matchingSubject = await db
    .select({
      email: user.email,
      emailVerified: user.emailVerified,
    })
    .from(account)
    .innerJoin(user, eq(user.id, account.userId))
    .where(and(eq(account.providerId, "google"), eq(account.accountId, subject)))
    .limit(1);
  if (matchingSubject[0]) {
    return (
      normalizeEmail(matchingSubject[0].email) === normalizeEmail(ownerEmail) &&
      matchingSubject[0].emailVerified
    );
  }

  const existingOwnerGoogleAccount = await db
    .select({ accountId: account.accountId })
    .from(account)
    .innerJoin(user, eq(user.id, account.userId))
    .where(
      and(
        eq(account.providerId, "google"),
        sql`lower(${user.email}) = ${normalizeEmail(ownerEmail)}`,
      ),
    )
    .limit(1);

  return existingOwnerGoogleAccount.length === 0;
}

/** Checks the stored user and Google subject used by sessions and API tokens. */
export async function isAuthorizedOwnerUser(
  userId: string,
  ownerEmail = configuredOwnerEmail(),
): Promise<boolean> {
  if (!ownerEmail) return env.NODE_ENV === "test";

  const result = await db
    .select({ id: user.id })
    .from(user)
    .innerJoin(account, eq(account.userId, user.id))
    .where(
      and(
        eq(user.id, userId),
        sql`lower(${user.email}) = ${normalizeEmail(ownerEmail)}`,
        eq(user.emailVerified, true),
        eq(account.providerId, "google"),
        ne(account.accountId, ""),
      ),
    )
    .limit(1);

  return result.length === 1;
}

export function isAllowedOwnerUserRecord(
  candidate: { email: string; emailVerified: boolean },
  ownerEmail = configuredOwnerEmail(),
): boolean {
  if (!ownerEmail) return env.NODE_ENV === "test";
  return candidate.emailVerified && normalizeEmail(candidate.email) === normalizeEmail(ownerEmail);
}

export function isAllowedOwnerAccount(accountData: {
  providerId: string;
  accountId: string;
}): boolean {
  return accountData.providerId === "google" && accountData.accountId.trim().length > 0;
}

/** The Google subject is the permanent owner identity and cannot be unlinked. */
export function isAllowedOwnerAccountDeletion(accountData: { providerId: string }): boolean {
  return accountData.providerId !== "google";
}
