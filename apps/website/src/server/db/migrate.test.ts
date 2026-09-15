import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * Populated upgrade test: run every migration that shipped before the project
 * inbox, insert rows the way that old server wrote them, then apply the new
 * migration and verify the backfill and additive columns.
 */

const MIGRATIONS_SOURCE = resolve(__dirname, "../../../drizzle");
const NEW_MIGRATION_TAG = "0019_grey_millenium_guard";

let workingDirectory: string;
let sqlite: Database.Database;

interface JournalEntry {
  idx: number;
  tag: string;
}

function runMigrationsFrom(folder: string, database: Database.Database): void {
  database.pragma("foreign_keys = OFF");
  try {
    migrate(drizzle(database), { migrationsFolder: folder });
  } finally {
    database.pragma("foreign_keys = ON");
  }
  expect(database.pragma("foreign_key_check")).toEqual([]);
}

beforeAll(() => {
  workingDirectory = mkdtempSync(join(tmpdir(), "hark-migrate-test-"));
  const folder = join(workingDirectory, "drizzle");
  cpSync(MIGRATIONS_SOURCE, folder, { recursive: true });

  const journalPath = join(folder, "meta", "_journal.json");
  const journal = JSON.parse(readFileSync(journalPath, "utf8")) as {
    entries: JournalEntry[];
  };
  const newEntry = journal.entries.find((entry) => entry.tag === NEW_MIGRATION_TAG);
  expect(newEntry, "expected the project inbox migration in the journal").toBeDefined();
  const legacyJournal = {
    ...journal,
    entries: journal.entries.filter(
      (entry) => entry.idx < (newEntry?.idx ?? Number.MAX_SAFE_INTEGER),
    ),
  };

  // Phase 1: the world before the deploy.
  writeFileSync(journalPath, JSON.stringify(legacyJournal));
  sqlite = new Database(":memory:");
  runMigrationsFrom(folder, sqlite);

  const now = Date.now();
  sqlite
    .prepare(
      "insert into user (id, name, email, email_verified, created_at, updated_at) values (?, ?, ?, 1, ?, ?)",
    )
    .run("user_legacy", "Legacy", "legacy@example.com", now, now);
  sqlite
    .prepare(
      "insert into service (id, user_id, title, token_hash, created_at, updated_at) values (?, ?, ?, ?, ?, ?)",
    )
    .run("svc_legacy", "user_legacy", "Legacy service", "legacy-hash", now, now);
  sqlite
    .prepare(
      "insert into api_token (id, user_id, name, token_hash, prefix, scopes, created_at) values (?, ?, ?, ?, ?, ?, ?)",
    )
    .run("tok_legacy", "user_legacy", "Legacy token", "legacy-token-hash", "hark_leg", "[]", now);
  const insertEvent = sqlite.prepare(
    "insert into event (id, service_id, title, body, status, delivered_count, created_at) values (?, ?, ?, ?, 'accepted', 1, ?)",
  );
  for (let index = 0; index < 3; index += 1) {
    insertEvent.run(`evt_legacy_${index}`, "svc_legacy", "Old", "Old body", now - index * 1_000);
  }
  sqlite
    .prepare(
      "insert into agent_notification (id, user_id, requester_token_id, title, body, accepted_count, created_at) values (?, ?, ?, ?, ?, 1, ?)",
    )
    .run("anot_legacy", "user_legacy", "tok_legacy", "Old", "Old agent body", now - 5_000);

  // Phase 2: the upgrade, with data in place.
  writeFileSync(journalPath, JSON.stringify(journal));
  runMigrationsFrom(folder, sqlite);
});

afterAll(() => {
  sqlite?.close();
  rmSync(workingDirectory, { recursive: true, force: true });
});

describe("project inbox migration on a populated database", () => {
  it("backfills read_at = created_at so no historical row launches unread", () => {
    const rows = sqlite
      .prepare("select id, created_at as createdAt, read_at as readAt from event")
      .all() as Array<{ id: string; createdAt: number; readAt: number | null }>;
    expect(rows).toHaveLength(3);
    for (const row of rows) expect(row.readAt).toBe(row.createdAt);

    const agentRows = sqlite
      .prepare("select created_at as createdAt, read_at as readAt from agent_notification")
      .all() as Array<{ createdAt: number; readAt: number | null }>;
    expect(agentRows).toHaveLength(1);
    expect(agentRows[0]?.readAt).toBe(agentRows[0]?.createdAt);
  });

  it("keeps old-server insert statements working against the upgraded schema", () => {
    // A not-yet-restarted server process writes rows without the new columns.
    sqlite
      .prepare(
        "insert into event (id, service_id, title, body, status, delivered_count, created_at) values (?, ?, ?, ?, 'accepted', 1, ?)",
      )
      .run("evt_after", "svc_legacy", "New", "New body", Date.now());
    const row = sqlite
      .prepare(
        "select read_at as readAt, project_id as projectId, body_format as bodyFormat, summary from event where id = ?",
      )
      .get("evt_after") as {
      readAt: number | null;
      projectId: string | null;
      bodyFormat: string | null;
      summary: string | null;
    };
    // Rows created after the upgrade are unread and unfiled until marked.
    expect(row).toEqual({ readAt: null, projectId: null, bodyFormat: null, summary: null });
  });

  it("enforces the per-user unique normalized project name and set-null deletes", () => {
    const now = Date.now();
    const insertProject = sqlite.prepare(
      "insert into project (id, user_id, name, normalized_name, created_at, updated_at) values (?, ?, ?, ?, ?, ?)",
    );
    insertProject.run("prj_1", "user_legacy", "Acme", "acme", now, now);
    expect(() => insertProject.run("prj_2", "user_legacy", "ACME", "acme", now, now)).toThrow(
      /UNIQUE/,
    );

    sqlite.prepare("update event set project_id = ? where id = ?").run("prj_1", "evt_after");
    sqlite.prepare("delete from project where id = ?").run("prj_1");
    const row = sqlite
      .prepare("select project_id as projectId from event where id = ?")
      .get("evt_after") as { projectId: string | null };
    expect(row.projectId).toBeNull();
  });

  it("sets interaction and Live Activity project references to null on delete", () => {
    const now = Date.now();
    sqlite
      .prepare(
        "insert into project (id, user_id, name, normalized_name, created_at, updated_at) values (?, ?, ?, ?, ?, ?)",
      )
      .run("prj_linked", "user_legacy", "Linked", "linked", now, now);
    sqlite
      .prepare(
        "insert into interaction (id, user_id, requester_token_id, project_id, title, prompt, kind, choices, action_digest, expires_at, created_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        "int_linked",
        "user_legacy",
        "tok_legacy",
        "prj_linked",
        "Decision",
        "Approve?",
        "approval",
        '["approve","deny"]',
        "a".repeat(64),
        now + 60_000,
        now,
      );
    sqlite
      .prepare(
        "insert into live_activity (id, user_id, requester_token_id, project_id, schema_version, props, status, expires_at, created_at, updated_at) values (?, ?, ?, ?, 1, '{}', 'active', ?, ?, ?)",
      )
      .run("act_linked", "user_legacy", "tok_legacy", "prj_linked", now + 60_000, now, now);

    sqlite.prepare("delete from project where id = ?").run("prj_linked");
    expect(
      sqlite
        .prepare("select project_id as projectId from interaction where id = ?")
        .get("int_linked"),
    ).toEqual({ projectId: null });
    expect(
      sqlite
        .prepare("select project_id as projectId from live_activity where id = ?")
        .get("act_linked"),
    ).toEqual({ projectId: null });
  });

  it("created the partial unread indexes", () => {
    const indexes = sqlite
      .prepare("select name from sqlite_master where type = 'index' and name in (?, ?, ?, ?)")
      .all(
        "event_unread_idx",
        "agent_notification_unread_idx",
        "event_project_created_at_idx",
        "agent_notification_project_created_at_idx",
      ) as Array<{ name: string }>;
    expect(indexes.map((index) => index.name).sort()).toEqual([
      "agent_notification_project_created_at_idx",
      "agent_notification_unread_idx",
      "event_project_created_at_idx",
      "event_unread_idx",
    ]);
  });

  it("adds nullable Android registration fields without changing legacy devices", () => {
    const columns = sqlite.prepare("pragma table_info(device)").all() as Array<{ name: string }>;
    expect(columns.map((column) => column.name)).toEqual(
      expect.arrayContaining([
        "fcm_token",
        "notification_schema_version",
        "promoted_notifications_capable",
      ]),
    );
  });

  it("backfills project links when upgrading from 0020 to 0021", () => {
    const upgradeRoot = mkdtempSync(join(tmpdir(), "hark-project-link-upgrade-"));
    const folder = join(upgradeRoot, "drizzle");
    cpSync(MIGRATIONS_SOURCE, folder, { recursive: true });
    const journalPath = join(folder, "meta", "_journal.json");
    const journal = JSON.parse(readFileSync(journalPath, "utf8")) as {
      entries: JournalEntry[];
    };
    const projectLinkEntry = journal.entries.find(
      (entry) => entry.tag === "0021_brainy_rachel_grey",
    );
    expect(projectLinkEntry).toBeDefined();
    writeFileSync(
      journalPath,
      JSON.stringify({
        ...journal,
        entries: journal.entries.filter(
          (entry) => entry.idx < (projectLinkEntry?.idx ?? Number.MAX_SAFE_INTEGER),
        ),
      }),
    );
    const database = new Database(":memory:");
    try {
      runMigrationsFrom(folder, database);
      const now = Date.now();
      database
        .prepare(
          "insert into user (id, name, email, email_verified, created_at, updated_at) values ('upgrade_user', 'Upgrade', 'upgrade@example.com', 1, ?, ?)",
        )
        .run(now, now);
      database
        .prepare(
          "insert into service (id, user_id, title, token_hash, created_at, updated_at) values ('upgrade_service', 'upgrade_user', 'Upgrade', 'upgrade-service-hash', ?, ?)",
        )
        .run(now, now);
      database
        .prepare(
          "insert into api_token (id, user_id, name, token_hash, prefix, scopes, created_at) values ('upgrade_token', 'upgrade_user', 'Upgrade', 'upgrade-token-hash', 'hark_upg', '[]', ?)",
        )
        .run(now);
      database
        .prepare(
          "insert into project (id, user_id, name, normalized_name, created_at, updated_at) values ('upgrade_project', 'upgrade_user', 'Upgrade', 'upgrade', ?, ?)",
        )
        .run(now, now);
      database
        .prepare(
          "insert into event (id, service_id, project_id, title, body, status, created_at) values ('upgrade_event', 'upgrade_service', 'upgrade_project', 'Upgrade', 'Body', 'accepted', ?)",
        )
        .run(now);
      database
        .prepare(
          "insert into interaction (id, user_id, requester_token_id, event_id, title, prompt, kind, choices, action_digest, expires_at, created_at) values ('upgrade_interaction', 'upgrade_user', 'upgrade_token', 'upgrade_event', 'Decision', 'Approve?', 'approval', '[\"approve\",\"deny\"]', ?, ?, ?)",
        )
        .run("a".repeat(64), now + 60_000, now);
      database
        .prepare(
          "insert into live_activity (id, user_id, requester_token_id, interaction_id, schema_version, props, status, expires_at, created_at, updated_at) values ('upgrade_activity', 'upgrade_user', 'upgrade_token', 'upgrade_interaction', 1, '{}', 'active', ?, ?, ?)",
        )
        .run(now + 60_000, now, now);

      writeFileSync(journalPath, JSON.stringify(journal));
      runMigrationsFrom(folder, database);
      expect(
        database
          .prepare(
            "select project_id as projectId from interaction where id = 'upgrade_interaction'",
          )
          .get(),
      ).toEqual({ projectId: "upgrade_project" });
      expect(
        database
          .prepare(
            "select project_id as projectId from live_activity where id = 'upgrade_activity'",
          )
          .get(),
      ).toEqual({ projectId: "upgrade_project" });
    } finally {
      database.close();
      rmSync(upgradeRoot, { recursive: true, force: true });
    }
  });
});
