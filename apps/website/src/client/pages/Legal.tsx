import { Link } from "react-router";

const updated = "August 9, 2026";

function LegalLayout({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="min-h-dvh">
      <header>
        <div className="mx-auto flex h-20 w-full max-w-3xl items-center justify-between px-6">
          <Link to="/" className="text-lg font-semibold">
            Hark
          </Link>
          <nav className="flex items-center gap-4 text-sm text-ink-subtle" aria-label="Primary">
            <Link className="transition hover:text-ink" to="/docs">
              Docs
            </Link>
            <Link className="transition hover:text-ink" to="/">
              Home
            </Link>
          </nav>
        </div>
      </header>
      <main className="mx-auto w-full max-w-3xl px-6 py-10">
        <h1 className="text-3xl font-semibold">{title}</h1>
        <p className="mt-3 text-sm text-ink-faint">Last updated {updated}</p>
        <div className="legal-copy mt-10 max-w-2xl space-y-8 text-sm leading-relaxed text-ink-muted">
          {children}
        </div>
      </main>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="mb-2 text-base font-semibold text-ink">{title}</h2>
      {children}
    </section>
  );
}

export function Privacy() {
  return (
    <LegalLayout title="Privacy Policy">
      <Section title="Overview">
        <p>
          Hark is self-hosted software. This policy explains the information a Hark deployment
          processes to deliver webhook notifications through its website and Android app. Hark does
          not sell personal information or use it for targeted advertising.
        </p>
      </Section>

      <Section title="Information we process">
        <ul className="list-disc space-y-2 pl-5">
          <li>
            Your Google account identifier, name, email address, and profile image when provided by
            Google sign-in.
          </li>
          <li>
            Service settings you create, including titles, image URLs, destination URLs, secret
            webhook-token hashes, and encrypted webhook tokens.
          </li>
          <li>
            Webhook and agent notification content such as titles, bodies, summaries, project names,
            images, destinations, idempotency keys, timestamps, read state, and delivery results.
          </li>
          <li>
            Device information needed for delivery, including the FCM registration token, device
            name, platform, capabilities, and last registration time.
          </li>
          <li>
            Agent access-token names, scopes, identifying prefixes, hashes, expiry and usage times.
            Plaintext agent tokens are shown once and are not stored by Hark.
          </li>
          <li>
            Approval and reply prompts, choices, expiry, response text or decision, requesting token
            identity, responding device, and response timestamps.
          </li>
          <li>
            Live Update task titles, status text, optional detail and progress, expiry and update
            history, and requesting token identity. Private mode replaces task content with generic
            text on the lock screen, but the Hark server still processes the task content.
          </li>
          <li>Limited technical logs used to secure, operate, and troubleshoot the service.</li>
          <li>
            Product analytics such as page and app-screen visits, feature lifecycle events,
            first-touch campaign labels, referring and outbound hostnames, app version, coarse
            outcomes, and related account, service, device, anonymous-install, or session
            identifiers. Hark never puts notification content, summaries, project names, prompts,
            replies, tokens, full URLs, IP addresses, email addresses, or user-agent strings in
            analytics.
          </li>
        </ul>
      </Section>

      <Section title="How we use information">
        <p>
          We use this information to authenticate your account, create and secure webhook endpoints,
          deliver notifications, show delivery activity, prevent duplicate or abusive requests,
          deliver requested interactions and return your response to the authorized agent, start and
          update Live Updates you authorize, provide support, and maintain the reliability and
          security of Hark.
        </p>
      </Section>

      <Section title="Service providers">
        <p>
          Hark relies on Google for authentication and Firebase Cloud Messaging, plus the
          infrastructure selected by the deployment operator for the website, API, and database.
          Hark sends pushes directly through FCM. It does not use Expo Push Service or EAS.
        </p>
      </Section>

      <Section title="Retention and deletion">
        <p>
          We retain account and service data while your account is active. Webhook and agent
          notification content, including titles, bodies, summaries, projects, and read state,
          persists in your inbox and is not expired on a schedule; it is removed when your account
          is deleted. You can permanently delete your account inside the Hark app. Deletion removes
          your services, devices, projects, notifications, and activity from the active database.
          Limited backup copies may remain until the deployment operator rotates them.
        </p>
      </Section>

      <Section title="Security and your choices">
        <p>
          Webhook URLs contain secret tokens and should be treated like passwords. You can rotate a
          webhook token or revoke a scoped agent token from the dashboard if it is exposed. Device
          responses require the signed-in account and a registered device identity. Hark uses access
          controls and encrypted network connections, but no online service can guarantee absolute
          security.
        </p>
      </Section>

      <Section title="Children">
        <p>
          Hark is not directed to children under 13, and we do not knowingly collect personal
          information from children under 13.
        </p>
      </Section>

      <Section title="Contact">
        <p>Send privacy requests to the operator of your Hark deployment.</p>
      </Section>
    </LegalLayout>
  );
}

export function Terms() {
  return (
    <LegalLayout title="Terms of Service">
      <Section title="Agreement">
        <p>
          By using Hark, you agree to these terms. If you do not agree, do not use the service. You
          must be legally able to form a binding agreement and provide accurate account information.
        </p>
      </Section>

      <Section title="The service">
        <p>
          Hark provides private webhook endpoints that convert submitted data into push
          notifications on registered devices. Features may change as the service develops, and beta
          or preview features may be modified or removed without notice.
        </p>
      </Section>

      <Section title="Agent interactions">
        <p>
          Scoped agent tokens may create approval or reply requests for your own registered devices.
          You are responsible for deciding what authority an agent receives and for reviewing
          prompts before responding. Hark does not guarantee that a push is delivered, seen, or
          answered, and callers must treat canceled, expired, denied, and missing responses safely.
        </p>
      </Section>

      <Section title="Your account and webhook secrets">
        <p>
          You are responsible for activity under your account and for keeping webhook URLs and
          account access secure. Agent API tokens are also credentials; grant only needed scopes,
          configure an expiry where practical, and revoke affected tokens if exposed.
        </p>
      </Section>

      <Section title="Acceptable use">
        <p>
          Do not use Hark to violate law, infringe rights, distribute malware, harass others,
          attempt unauthorized access, overload the service, evade rate limits, or send content you
          do not have permission to process. We may suspend abusive or harmful activity.
        </p>
      </Section>

      <Section title="Your content">
        <p>
          You retain ownership of content you submit. You grant Hark permission to process that
          content only as needed to operate the service. You are responsible for ensuring your
          webhook content, images, and destination links are lawful and appropriately licensed.
        </p>
      </Section>

      <Section title="Third-party services">
        <p>
          Hark depends on Google services and the infrastructure chosen by the deployment operator.
          Their availability and terms are outside Hark's control, and integrations may stop working
          if those services change.
        </p>
      </Section>

      <Section title="Availability and warranties">
        <p>
          Hark is provided "as is" and "as available." Push delivery is not guaranteed, may be
          delayed or duplicated, and can be affected by device settings and third-party services. To
          the extent permitted by law, Hark disclaims implied warranties and is not liable for
          indirect, incidental, special, or consequential damages.
        </p>
      </Section>

      <Section title="Termination and changes">
        <p>
          You may stop using Hark or delete your account at any time. We may suspend access for
          violations, security risks, or service discontinuation. We may update these terms and will
          post the updated date on this page.
        </p>
      </Section>

      <Section title="Contact">
        <p>Send questions about these terms to the operator of your Hark deployment.</p>
      </Section>
    </LegalLayout>
  );
}
