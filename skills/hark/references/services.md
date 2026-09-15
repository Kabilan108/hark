# Hark integration webhooks

Use a service webhook for a non-agent script or external integration that needs
separate ownership, revocation, or sender defaults. Examples include CI and
another application. Agent notifications, including scheduled agents running as
the user, use the current machine's `harkctl` token with `--project`; projects do
not need webhooks.

On the personal fleet, read
`~/dotfiles/agents/skills/notify/references/fleet.md` before provisioning a
service. It defines the private capture, encryption, host selection, validation,
and activation procedure.

## Send through an integration

Use curl's config mechanism so the credential stays out of shell arguments and
output. Avoid verbose and trace mode.

```sh
curl --config "$HOME/.config/hark/integrations/release-ci.curl" \
  --silent --show-error --fail \
  --header 'Content-Type: application/json' \
  --header 'Idempotency-Key: unique-job-complete' \
  --data-binary '{"body":"Checks passed. Ready for review.","project":"Hark"}'
```

The credential selects the sender. `project` controls inbox grouping. Service
defaults provide the title, image, and link; request JSON can override them.
Encode dynamic content with a JSON serializer instead of string concatenation.

For an interaction, add `response` to the webhook payload:

```json
{"body":"Deploy reviewed commit abc123 to staging?","project":"Hark","response":{"type":"approval","expiresInSeconds":900}}
```

Response types are `approval`, `yes_no`, and `text`. Retain the returned
`eventId`. Read the result with GET `<webhookUrl>/events/<eventId>`. A service
interaction returns an event ID, while a direct CLI question returns an
interaction ID. Use a structured HTTP client to append the path to the privately
loaded URL, and report only response JSON. An authenticated callback is another
option for an existing automation receiver. The backend retries callbacks, so
receivers must tolerate duplicates.

Service Live Updates use POST `<webhookUrl>/live-activities`, PATCH
`<webhookUrl>/live-activities/<id-or-key>`, and POST
`<webhookUrl>/live-activities/<id-or-key>/end`. They accept the corresponding
activity JSON fields. Set the project when starting the activity.

Successful FCM acceptance is not proof of phone display. Verify configuration
without sending unsolicited test messages. Use a user-requested smoke test for
display and response checks.
