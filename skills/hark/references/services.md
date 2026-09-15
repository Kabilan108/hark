# Hark service webhooks

For fleet provisioning, first read
`~/dotfiles/agents/skills/notify/references/fleet.md`. It is the authoritative
agenix setup and token-renewal procedure shared by sietch and jacurutu. Creating
a service includes encrypted credential distribution to both hosts, unless the
user explicitly limits its scope. Leave requested skill edits uncommitted and
ask the user to rebuild after validation; a local credential file is not enough.

General work uses the local machine's CLI identity. Moberg work uses
`~/.config/hark/services/moberg.curl`, unless the user explicitly selects another
provisioned service.

## Sending through a service

Use curl's existing configuration mechanism. This puts the credential in neither
shell arguments nor output; avoid verbose/trace mode.

```sh
curl --config "$HOME/.config/hark/services/moberg.curl" \
  --silent --show-error --fail \
  --header 'Content-Type: application/json' \
  --header 'Idempotency-Key: unique-job-complete' \
  --data-binary '{"body":"Checks passed. Ready for review.","project":"moberg"}'
```

The service and project are independent: the credential selects the sender,
while `project` groups ordinary messages in the app. Service defaults provide
the title; include a title or deliverable URL in JSON to override them. Encode
dynamic content with a JSON serializer, not string concatenation.

For service-attributed interactions, add `response` to the webhook payload:

```json
{"body":"Deploy reviewed commit abc123 to staging?","response":{"type":"approval","expiresInSeconds":900}}
```

Response types are `approval`, `yes_no`, or `text`. Retain the returned `eventId`.
Read the result with GET `<webhookUrl>/events/<eventId>`; a service interaction
returns an event ID, whereas direct CLI asks return an interaction ID. Use a
structured HTTP client to append this path to the privately loaded URL, and
report only the response JSON, never the credential. Alternatively configure
an authenticated response callback for an existing automation receiver. The
backend retries callbacks; receivers should tolerate duplicate delivery.

Service Live Updates use POST `<webhookUrl>/live-activities`, PATCH
`<webhookUrl>/live-activities/<id-or-key>`, and POST
`<webhookUrl>/live-activities/<id-or-key>/end`. These accept the corresponding
activity JSON fields. Use the CLI for direct agent asks/activities when service
attribution is unnecessary; that provides the existing managed-wait commands.

Successful FCM acceptance is not proof of phone display. Verify configuration
without sending unsolicited test messages; use a user-requested smoke test for
end-to-end display and response checks.
