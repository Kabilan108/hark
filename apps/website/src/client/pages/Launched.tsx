import { Link } from "react-router";

export function Launched() {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="mx-auto flex h-20 w-full max-w-3xl items-center justify-between px-6">
        <Link to="/" className="text-lg font-semibold">
          Hark
        </Link>
        <nav className="flex items-center gap-4 text-sm text-ink-subtle" aria-label="Primary">
          <Link className="transition-colors hover:text-ink" to="/docs">
            Docs
          </Link>
          <Link className="transition-colors hover:text-ink" to="/">
            Home
          </Link>
        </nav>
      </header>

      <main className="mx-auto w-full max-w-3xl flex-1 px-6 pt-10 pb-24">
        <article className="max-w-2xl">
          <h1 className="max-w-xl text-4xl leading-[1.05] font-semibold tracking-[-0.035em] text-balance sm:text-5xl">
            Hark for Android
          </h1>
          <p className="mt-5 max-w-xl text-lg leading-relaxed text-pretty text-ink-subtle">
            This Android-only fork runs from your own Node and SQLite backend. It sends data-only
            messages directly through Firebase Cloud Messaging.
          </p>
          <a
            className="mt-7 inline-flex min-h-11 items-center justify-center rounded-full bg-accent px-6 py-3 text-sm font-semibold text-on-accent transition-[background-color,scale] hover:bg-accent-hover active:scale-[0.96]"
            href="/downloads/hark-android-1.2.2.apk"
          >
            Download signed Android APK
          </a>

          <div className="mt-12 space-y-8 text-base leading-relaxed text-ink-muted">
            <section>
              <h2 className="text-lg font-semibold text-ink">Notifications and responses</h2>
              <p className="mt-2 max-w-xl text-pretty">
                Webhooks and harkctl can send notifications, approval actions, yes or no prompts,
                text replies, callbacks, and device-targeted messages. The self-hosted deployment
                enables every feature without a Hark subscription.
              </p>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-ink">Live Updates</h2>
              <p className="mt-2 max-w-xl text-pretty">
                The Activity API creates an ongoing Android progress notification. On supported
                devices, Hark can ask Android to promote it as a Live Update when the user enables
                watched activities. Other devices keep the regular progress notification.
              </p>
            </section>

            <section>
              <h2 className="text-lg font-semibold text-ink">Your deployment</h2>
              <p className="mt-2 max-w-xl text-pretty">
                The app connects only to the backend origin built into it. Push delivery uses your
                Firebase project and service account. Expo Push Service and EAS are not part of the
                delivery or build path. See the{" "}
                <Link
                  className="font-medium text-accent-text underline underline-offset-4"
                  to="/docs"
                >
                  API documentation
                </Link>{" "}
                for payloads and delivery behavior.
              </p>
            </section>
          </div>
        </article>
      </main>

      <footer className="mx-auto flex w-full max-w-3xl items-center justify-between px-6 py-6 text-xs text-ink-faint">
        <span>Hark · self-hosted webhook → Android.</span>
        <nav className="flex items-center gap-3" aria-label="Legal">
          <Link className="transition-colors hover:text-ink-muted" to="/privacy">
            Privacy
          </Link>
          <Link className="transition-colors hover:text-ink-muted" to="/terms">
            Terms
          </Link>
        </nav>
      </footer>
    </div>
  );
}
