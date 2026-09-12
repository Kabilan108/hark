import { beforeAll, describe, expect, it } from "vitest";

process.env.NODE_ENV = "test";
process.env.DATABASE_URL = ":memory:";
process.env.OWNER_EMAIL = "owner@example.com";

let db: typeof import("../db")["db"];
let schema: typeof import("../db/schema");
let owner: typeof import("./owner");

beforeAll(async () => {
  ({ db } = await import("../db"));
  schema = await import("../db/schema");
  owner = await import("./owner");
  const { runMigrations } = await import("../db/migrate");
  runMigrations();

  const now = new Date();
  await db.insert(schema.user).values([
    {
      id: "owner",
      name: "Owner",
      email: "owner@example.com",
      emailVerified: true,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "intruder",
      name: "Intruder",
      email: "intruder@example.com",
      emailVerified: true,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "apple-only-owner",
      name: "Old owner row",
      email: "old-owner@example.com",
      emailVerified: true,
      createdAt: now,
      updatedAt: now,
    },
  ]);
  await db.insert(schema.account).values([
    {
      id: "owner-google-account",
      accountId: "google-owner-subject",
      providerId: "google",
      userId: "owner",
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "owner-legacy-apple-account",
      accountId: "legacy-apple-subject",
      providerId: "apple",
      userId: "owner",
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "intruder-google-account",
      accountId: "google-intruder-subject",
      providerId: "google",
      userId: "intruder",
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "old-apple-account",
      accountId: "apple-subject",
      providerId: "apple",
      userId: "apple-only-owner",
      createdAt: now,
      updatedAt: now,
    },
  ]);
});

describe("Google owner admission", () => {
  it("requires the configured email, Google's verification claim, and a stable subject", async () => {
    await expect(
      owner.isAllowedGoogleOwnerProfile({
        sub: "google-owner-subject",
        email: "OWNER@example.com",
        email_verified: true,
      }),
    ).resolves.toBe(true);
    await expect(
      owner.isAllowedGoogleOwnerProfile({
        sub: "google-owner-subject",
        email: "intruder@example.com",
        email_verified: true,
      }),
    ).resolves.toBe(false);
    await expect(
      owner.isAllowedGoogleOwnerProfile({
        sub: "google-owner-subject",
        email: "owner@example.com",
        email_verified: false,
      }),
    ).resolves.toBe(false);
    await expect(
      owner.isAllowedGoogleOwnerProfile({
        email: "owner@example.com",
        email_verified: true,
      }),
    ).resolves.toBe(false);
  });

  it("rejects a different Google subject after the owner identity is bound", async () => {
    await expect(
      owner.isAllowedGoogleOwnerProfile({
        sub: "replacement-subject",
        email: "owner@example.com",
        email_verified: true,
      }),
    ).resolves.toBe(false);
    await expect(
      owner.isAllowedGoogleOwnerProfile({
        sub: "google-intruder-subject",
        email: "owner@example.com",
        email_verified: true,
      }),
    ).resolves.toBe(false);
  });

  it("allows the configured owner to bind their first Google subject", async () => {
    await expect(
      owner.isAllowedGoogleOwnerProfile(
        {
          sub: "first-subject",
          email: "new-owner@example.com",
          email_verified: true,
        },
        "new-owner@example.com",
      ),
    ).resolves.toBe(true);
  });
});

describe("stored owner authorization", () => {
  it("requires the verified owner user and a nonempty Google account subject", async () => {
    await expect(owner.isAuthorizedOwnerUser("owner")).resolves.toBe(true);
    await expect(owner.isAuthorizedOwnerUser("intruder")).resolves.toBe(false);
    await expect(
      owner.isAuthorizedOwnerUser("apple-only-owner", "old-owner@example.com"),
    ).resolves.toBe(false);
  });

  it("rejects non-Google account creation and unverified owner records", () => {
    expect(owner.isAllowedOwnerAccount({ providerId: "google", accountId: "stable-subject" })).toBe(
      true,
    );
    expect(owner.isAllowedOwnerAccount({ providerId: "apple", accountId: "subject" })).toBe(false);
    expect(
      owner.isAllowedOwnerUserRecord({
        email: "owner@example.com",
        emailVerified: false,
      }),
    ).toBe(false);
  });

  it("keeps the bound Google subject from being unlinked when a legacy Apple row exists", async () => {
    await expect(owner.isAuthorizedOwnerUser("owner")).resolves.toBe(true);
    expect(owner.isAllowedOwnerAccountDeletion({ providerId: "google" })).toBe(false);
    expect(owner.isAllowedOwnerAccountDeletion({ providerId: "apple" })).toBe(true);
  });
});
