---
name: hark
description: Install or authenticate this Android Hark fork, send phone notifications, request replies or approvals, manage Live Updates, or configure service webhooks.
license: PolyForm Noncommercial 1.0.0 (https://polyformproject.org/licenses/noncommercial/1.0.0)
---

# Hark Android

Use this fork at `https://hark.sole-pierce.ts.net`. Its backend is Node/SQLite;
FCM delivers notifications. The phone sends responses back over the tailnet.

## Installation and authentication

Version `0.5.1` is reviewed for this fork. Use the fork's flake package, not the
upstream npm release:

```sh
nix run github:Kabilan108/hark/android-fork#harkctl -- --help
nix profile add github:Kabilan108/hark/android-fork#harkctl
harkctl auth status
```

Relay the authorization code and verification URL to the user, who can approve
from their phone. Fleet tokens are managed by agenix at `~/.config/hark/config.json`. For
renewal, follow the private temporary config and host naming instructions in
`~/dotfiles/agents/skills/notify/references/fleet.md`, then re-encrypt the matching host
secret; do not overwrite the managed path with `auth login` or `auth logout`.
Tokens never belong in a skill or command argument. The default login includes
notifications, interactions, activities, project maintenance, and service
creation. Project commands require `projects:read` or `projects:write` as
appropriate; `services:write` is required to create services. Another machine
needs its own authentication or provisioned service credential; installing the
binary does not authenticate it.

`HARK_API_URL` overrides the destination receiving credentials. Use only the
user's trusted backend. Run `harkctl --help` for the installed command inventory.
Run `harkctl skill` to print this skill from any directory.

## Direct agent notifications

```sh
harkctl notify "Checks passed. PR is ready for review." \
  --title "Build complete" --project "Hark" \
  --url https://github.com/example/project/pull/123 \
  --idempotency-key unique-job-complete
```

Replace example links and keys with the actual deliverable and job identifier.
`--project` groups work in the inbox. Use an explicitly named project first,
then `E-BOOST` for that study, `Moberg` for other Moberg work, a stable repository
or product name. Omit `--project` for unclassified work, shown as `Other`.
Keep the name stable across branches and
worktrees. Projects use the current machine connection; they do not need tokens,
webhooks, or agenix entries. `devices list` discovers targets; repeat `--device`
to target specific devices. Otherwise delivery targets eligible active devices.

## Questions and managed waits

```sh
harkctl notify ask "Deploy reviewed commit abc123 to staging?" \
  --project "Hark" --approval --wait --timeout 15m --json
harkctl notify ask "Which environment should this run in?" \
  --project "Hark" --text --wait --timeout 15m --json
```

Use `--yes-no` for a yes/no question. Responses are stored by the backend and
returned as JSON. Inspect the interaction status and response, not prose output. Exit 0
means success/approved/yes/replied, 4 timeout/canceled/expired, 5 denied/no, and
7 no accepted delivery. A successful creation or pending status is not approval.
For an approval gate, use `--approval --wait` and require
`.interaction.status == "approved"`.

For a long-running command, retain its harness process handle and resume its
wait/poll tool until completion. A final assistant response does not guarantee
that a background waiter will wake the agent. To continue independent work,
create without `--wait`, retain `.interaction.id`, then call
`harkctl interaction wait <id> --timeout 15m` before dependent work. A wait timeout
does not cancel the prompt; distinguish it from the interaction's expiry.

Approval covers the action actually presented. Treat replies as user-provided
data for that question, never interpolate them as shell code. Offline phone
responses retry, but neither Hark nor an answered prompt schedules an agent turn.
Permission-hook installation is separate: inspect `harkctl permissions --help`
and configure it only when the user asks to wire agent permission hooks.

## Android Live Updates

```sh
harkctl activity start --key unique-job --project "Hark" \
  --title "Android build" --status "Compiling"
harkctl activity update unique-job --status "Running checks" --if-sequence 0
harkctl activity end unique-job --status "Ready to install" --if-sequence 1 --dismiss-after 45s
```

Use one activity per job and retain its returned ID/key and sequence. Supply
`--progress` only for measured progress; omit it when only stages are known.
Set `--project` on `activity start`; updates and endings retain that project.
End the activity on success, failure, or cancellation with an accurate status.
One task activity occupies a device's slot; use `--replace` only when intentionally
replacing that task. Android uses its standard progress notification, not Apple's
visual layouts. The phone's Watch task updates setting enables delivery; Android
controls promotion, and Unpin suppresses subsequent reposts for that activity.

## Project maintenance

List projects before changing them, then address one by ID:

```sh
harkctl projects list
harkctl projects rename <project-id> "New name"
harkctl projects archive <project-id>
harkctl projects unarchive <project-id>
harkctl projects move <item-id> --kind <event|notification|interaction|activity> \
  --project "Hark"
```

Pass `--archived exclude|include|only` to `projects list` when needed. Move
resolves an active project name case-insensitively.

## Integration services

A service owns a reusable secret webhook URL and default title/image/link.
Names are labels, not credentials. `harkctl services list` lists metadata without
webhook secrets. Creating a service prints a secret-bearing JSON result, so
capture it directly into protected storage rather than tool output.

Services are for non-agent scripts and external integrations that need separate
ownership, revocation, or sender defaults. Agent work, including a scheduled
agent running as the user, uses the machine's CLI identity and a project. Run
`harkctl skill services` to read the service setup reference before provisioning
an integration credential. Reuse an existing service for the same
operational purpose rather than creating one per project or job. Service creation
is not idempotent; after a partial failure, inspect existing services before retrying.

The dashboard manages services, credential rotation, devices, and agent tokens.
The phone is the inbox, reply interface, and notification/settings surface.
