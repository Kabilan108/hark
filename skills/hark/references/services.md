# Service setup and native webhook use

On sietch, these services and mode-0600 curl configurations are provisioned:

| Service | Protected file |
| --- | --- |
| alerts | `~/.config/hark/services/alerts.curl` |
| moberg | `~/.config/hark/services/moberg.curl` |

Other machines need provisioning before use. These files use curl's native configuration format, not a new CLI feature. Keep them out
of Git and skill content. Their `url` value is the service's full secret webhook
URL. Each sender machine needs the appropriate file, or its automation platform's
secret store equivalent. The tailnet policy must also let that machine reach
`svc:hark` on TCP 443. Public CI runners need tailnet connectivity first.

## One-time creation

Authenticate the fork's CLI, then inspect `harkctl services list`. If the named
service already exists, recover its URL through the owner's dashboard rather
than creating a duplicate. Rotate only when the user intends to invalidate
existing senders. For a missing service, this example creates `alerts` and writes
its curl configuration without displaying the credential:

```sh
python3 <<'PY'
import json
import os
from pathlib import Path
import subprocess
from urllib.parse import urlsplit

name = "alerts"  # Use "moberg" for the other service.
folder = Path.home() / ".config/hark/services"
folder.mkdir(parents=True, exist_ok=True, mode=0o700)
path = folder / f"{name}.curl"
# Reserve the destination before creating a non-idempotent remote service.
fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
try:
    result = subprocess.run(
        ["harkctl", "services", "create", "--title", name],
        check=True, capture_output=True, text=True,
    )
    data = json.loads(result.stdout)
    url = data["webhookUrl"]
    parsed = urlsplit(url)
    if (parsed.scheme != "https" or parsed.netloc != "hark.sole-pierce.ts.net"
            or not parsed.path.startswith("/hooks/") or parsed.query or parsed.fragment):
        raise ValueError("Unexpected webhook origin or path")
    with os.fdopen(fd, "w") as output:
        fd = -1
        output.write("url = " + json.dumps(url) + "\n")
    print(f"Stored service credential in {path}")
finally:
    if fd != -1:
        os.close(fd)
# On failure, retain the reserved file and inspect the dashboard before retrying.
PY
```

Copy credentials to other machines using the user's secret provisioning tools.
The service webhook can send without a CLI login; it is itself a credential.
The CLI login is for creating/managing services and direct agent operations.

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
