# Projects and senders

A project groups work by subject. Sender credentials identify and authorize the
agent or integration doing that work. Choosing a project never requires a new
credential.

Sietch and jacurutu use their separate agenix-managed agent tokens for ordinary
and scheduled agent work. The notify skill selects an explicit project first,
then E-BOOST study work, other Moberg work, or the stable repository/product name.
Omit the project for genuinely unclassified work, shown as Other.

```sh
harkctl notify "Checks passed" --project E-BOOST
harkctl notify ask "Proceed with the reviewed change?" --approval --project E-BOOST --wait
harkctl activity start --key study-check --title "Study checks" --project E-BOOST
```

Projects appear on first delivery. Their names are case-insensitive within the
account. Questions, approvals, and activities retain the project as they progress.
New work restores an archived project to the active inbox. Replaying an existing
request does not restore it.

Use Projects in the web dashboard or the CLI to rename, archive, and restore.
Moving items is a CLI-only operation. Renaming to an existing name is a conflict, not an implicit merge.
Archiving preserves history. Pending decisions remain accessible. Empty projects
are hidden from the phone inbox but remain manageable.

```sh
harkctl projects list --archived include
harkctl projects rename <project-id> "New name"
harkctl projects archive <project-id>
harkctl projects unarchive <project-id>
harkctl projects move <item-id> --kind notification --project E-BOOST
harkctl projects move <item-id> --kind notification --unfiled
```

The move kind is event for a webhook notification, notification for a direct
agent message, interaction for a question/approval, or activity for a Live Update.
Related interaction/activity records move together with their parent item.
Project management requires projects:read/projects:write; sending with a project
uses the existing delivery permissions.

## Integration credentials

Provision webhook services by operational purpose when independent ownership,
revocation, or sender attribution is useful. Distribute these credentials with
agenix. Do not create a webhook service just to create a project.

Current timer recommendations, without changing the timers:

| Job | Current notifier | Recommended sender | Project |
| --- | --- | --- | --- |
| E-BOOST reviewer report, home/services/moberg.nix | discord-notify | Dedicated report webhook | E-BOOST |
| Meeting Minutes, home/services/meeting-minutes.nix | discord-notify | Host agent token | Meeting Minutes |
| Monthly stale-direnv report, home/services/storage-maintenance.nix | discord-notify | System maintenance webhook | Dotfiles |
| Tracer digest, home/services/tracer-digest.nix, apparently disabled | discord-notify | Host agent token if enabled | Tracer |

Battery alerts remain local desktop notifications. Backup, Moberg GC/fetch,
tracer sync, and agent updates currently have no notification transport to migrate.

## Morning acceptance check

1. Install the new versioned APK over the existing app and open it. Your login
   and device registration should remain intact; old test history is cleared.
2. Send a message under E-BOOST from a machine token. Confirm the project is
   E-BOOST and sender attribution identifies the machine.
3. Send a project-scoped question and approval. Respond on the phone and confirm
   each waiting CLI returns the corresponding answer.
4. Start, update, and end a project-scoped Live Update. Confirm it stays in the
   same project and its system notification updates in place.
5. In the dashboard, rename a project, move an item, archive and restore it.
   Confirm the phone refreshes. Send new work to an archived project and confirm
   it returns to the active inbox.

## Installing the CLI

The fleet flake installs `harkctl` and shell completions. The installed CLI ships
its own reference: `harkctl skill` and `harkctl skill services` work without a
repository checkout. `harkctl completions bash|zsh|fish` emits completions for
manual installations; the Nix package installs them automatically.

The obsolete project-specific webhook agenix declarations are removed. Sync
dotfiles and rebuild each host after updating the Hark input.

## Verified delivery, September 15

Android 1.3.0, versionCode 4:
https://hark.sole-pierce.ts.net/downloads/hark-android-1.3.0.apk

SHA-256: `e3e367b218ae8acb5158237a7a3862a85e07d6a305f3396d58f7464fa16310a7`.

Verified 244 website tests, 42 Expo tests, 59 CLI tests, both application
typechecks, the Nix CLI build, APK signing, and independent review. Emulator
verification covered project grouping, approval and text replies returning to
managed CLI waits, activity progression/end, project history, remote rename
refresh, dashboard move, archive/replay behavior, and fresh-delivery restoration.
The HTTPS APK download matched the built file byte-for-byte.

All test deliveries used a separate database with only the emulator registered.
The live URL now uses the cleaned production database; its integrity and foreign
keys pass, its history/projects are empty, and the owner and both devices remain.
No physical phone notification was sent during overnight testing.

The backend is running in the task-owned tmux session `hark-project-backend` on
loopback 8787. The NixOS system service remains stopped as requested. To hand it
back to systemd later:

```sh
tmux kill-session -t hark-project-backend
sudo systemctl start hark
```

The pre-cleanup SQLite backup is under `/vault/userdata/hark/backups/` with the
prefix `pre-project-workflow-20260915T044502Z`. It contains authentication data;
keep it private. The separate emulator test database is not the live database.
