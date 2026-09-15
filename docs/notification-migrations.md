# Migrating timer notifications to Hark

Apply these changes after the Hark release is active on both hosts. This is a
runbook, not a record of migrations already performed. Keep every existing
schedule, report, queue, and dry-run behavior. Change only notification delivery.

## Provision the two integration credentials

Meeting Minutes and Tracer use each host's existing Hark machine connection.
The non-agent E-BOOST and fleet jobs get separate service credentials:

| Hark service | Agenix runtime path | Payload project |
| --- | --- | --- |
| E-BOOST Automations | `~/.config/hark/integrations/e-boost-automations.curl` | `E-BOOST` |
| Fleet Maintenance | `~/.config/hark/integrations/fleet-maintenance.curl` | `Dotfiles` |

1. Run `harkctl services list` and reuse an exact existing service. Service
   creation is not idempotent.
2. For each missing service, follow
   `~/dotfiles/agents/skills/notify/references/fleet.md`. Set `umask 077`, capture
   `harkctl services create --title <name>` into a private temporary file, and
   parse `.webhookUrl` without printing it. Verify the origin and `/hooks/` path.
3. Store only `url = "<webhookUrl>"` in each curl config. Encrypt the configs as
   `secrets/hark/e-boost-automations.curl.age` and
   `secrets/hark/fleet-maintenance.curl.age`.
4. Add both sietch and jacurutu recipient keys in `secrets.nix`. Declare both
   secrets in `user.nix` for the two Hark hosts, with owner `kabilan`, group
   `users`, and mode `0600`, at the runtime paths above.
5. Evaluate both host configurations and verify that authorized identities can
   decrypt the files without displaying them. Remove the private temporary
   directory. Transfer the reviewed dotfiles change, then let the user rebuild
   each host.

The webhook credential identifies the sending service. The explicit `project`
field chooses the inbox group. Never put a webhook URL in source, a command
argument, a log, or a report.

## E-BOOST reviewer report

Source:
`/vault/work/moberg/dev-server/eboost-scripts/EBOOST/change-points/scripts/eboost-review-report.py`

Timer: `moberg-eboost-reviewer-report` in
`~/dotfiles/home/services/moberg.nix`. It currently runs `preview --notify` on
Monday at 09:00 America/New_York, with a five-minute randomized delay.

1. Replace `Config.notification_channel` and the TOML `notifications.channel`
   value with the E-BOOST curl-config path. Keep the configured title,
   `E-BOOST Weekly Review Report`.
2. Change `notify()` to build `{"title": ..., "body": ..., "project":
   "E-BOOST"}` with `json.dumps()`. Pass that JSON through
   `CommandRunner.run(..., input_text=payload)` and curl's `--data-binary @-`.
   Do not place dynamic JSON on the command line.
3. Invoke curl with the expanded credential path, `--silent --show-error
   --fail-with-body`, `Content-Type: application/json`, and an
   `Idempotency-Key` header. Avoid verbose or trace mode. Keep notification
   payloads within 8,000 characters and 16,384 UTF-8 bytes. Use the existing
   run reference or draft URL when a shorter message is needed.
4. Derive the idempotency key from the report week, outcome, and a digest of the
   canonical payload. Retries of the same payload must reuse the key. A changed
   payload must use a new key.
5. Update `doctor()` to require curl and a readable regular credential file in
   place of `discord-notify`. Do not test the webhook or expose its contents in
   `doctor()`.
6. Cover success, blocked/failure, missing credentials, an HTTP failure, and an
   identical retry with mocked subprocess calls. Run `preview --no-notify`
   against the normal inputs before an authorized live smoke test. Leave the
   Nix wrapper and timer schedule unchanged.

## Meeting Minutes

Source: `notify_job()` in `~/dotfiles/bin/meeting-minutes`

Units: `meeting-minutes-worker.service`, its path unit, and its recovery timer
in `~/dotfiles/home/services/meeting-minutes.nix`.

1. Build a top-level notification object with `body`, `title`, and `project`:

   ```json
   {"body":"<body>","title":"<title>","project":"Meeting Minutes"}
   ```

   Serialize it with `json.dumps()` and pass it as subprocess input to
   `harkctl notify --stdin --idempotency-key <key>`. The CLI's `--stdin` expects
   one top-level JSON object. A raw body string is not valid stdin input, and
   explicit flags override the matching fields from JSON.
2. Keep the existing success and failure titles, body construction, stderr
   capture, and `notification_attempted`, `notification_sent`, and
   `notification_error` bookkeeping. Hark has no severity option, so the title
   and body continue to carry the outcome.
3. Use a key such as `meeting-minutes:<job_id>:success` or
   `meeting-minutes:<job_id>:failure`. The outcome suffix prevents a later
   success from conflicting with a prior failure.
4. Use the existing host config at `~/.config/hark/config.json`. Do not create a
   Meeting Minutes service or copy its token into another secret. `harkctl` is
   already a Home Manager package; use its Nix store executable path in the
   unit or otherwise give the worker an explicit executable path.
5. Mock the subprocess and check the argument order, project, key, error
   recording, and the existing one-attempt guard. Use a fresh controlled queue
   item for an authorized live test. Do not replay a completed recording.
6. Transfer the reviewed script and module changes, then let the user rebuild
   jacurutu. Its existing machine credential remains the authentication source.

## Stale-direnv and other storage reports

Source: `reportStaleDirenvs` in
`~/dotfiles/home/services/storage-maintenance.nix`.

1. Replace both `discord-notify` branches, including the no-candidates branch,
   with the Fleet Maintenance curl config. Preserve both existing titles and
   set `project` to `Dotfiles`.
2. Use `jq -n` or another JSON encoder to build the payload, then pipe the JSON
   to curl with `--data-binary @-`. Add `jq` and curl to `runtimeInputs`. Never
   interpolate candidate paths into JSON source or log the curl config.
3. Use an idempotency key based on the report month and a digest of the payload.
   Preserve `STALE_DIRENV_REPORT_DRY_RUN=1` as a true no-send mode that prints
   the proposed title, body, and project locally without invoking curl.
4. Test no candidates, several candidates including quotes and newlines, an
   oversized list, an identical retry, and curl failure. Keep the body within
   Hark's 8,000-character and 16,384-byte limits. If the complete list is too
   large, write or publish the report first and send its path or URL with the
   counts. Do not silently drop candidates.
5. Use the same Fleet Maintenance service and `Dotfiles` project for later
   storage-health reports that share this operational owner. The cache cleanup,
   AppImage pruning, and weekly backup push/janitor jobs currently send no remote
   notification, so this migration does not add one. Keep battery warnings as
   desktop notifications.
6. Preserve all calendar and randomized-delay settings. Evaluate the generated
   units before the user rebuilds each affected host.

## Tracer digest

The release adds a TODO to `~/dotfiles/home/services/tracer-digest.nix`. Before
enabling that service, replace `discord-notify` in `bin/tracer-digest` with
`harkctl notify --project "Tracer"`, using the host's existing machine
credential. The service remains disabled and its notification code is otherwise
unchanged in this release.
