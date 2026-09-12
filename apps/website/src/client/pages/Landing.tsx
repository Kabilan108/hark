import { Link } from "react-router";
import { GoogleButton } from "../components/GoogleButton";
import { signInWithGoogle, useSession } from "../lib/auth";

export function Landing() {
  const { data: session, isPending } = useSession();

  return (
    <div className="hark-landing flex min-h-dvh flex-col">
      <div className="hark-landing-ambient" aria-hidden="true" />
      <header className="mx-auto flex h-20 w-full max-w-6xl items-center justify-between px-6">
        <Link to="/" className="flex items-center gap-1.5 text-lg font-semibold">
          <span aria-hidden="true" className="size-[18px] rounded-[5px] bg-[#035B49]" />
          <span>Hark</span>
        </Link>
        <nav className="flex items-center gap-4" aria-label="Primary">
          <Link className="text-ink-subtle hover:text-ink text-sm transition" to="/docs">
            Docs
          </Link>
          <Link className="text-ink-subtle hover:text-ink text-sm transition" to="/pricing">
            Pricing
          </Link>
          {session ? (
            <Link
              to="/dashboard"
              className="bg-accent hover:bg-accent-hover text-on-accent rounded-full px-4 py-2 text-sm font-medium transition"
            >
              Open dashboard
            </Link>
          ) : null}
        </nav>
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 px-6">
        <div className="grid items-center gap-y-8 pt-10 pb-10 lg:min-h-[calc(100dvh-5rem)] lg:grid-cols-[auto_auto] lg:justify-center lg:gap-x-24 lg:pt-0 lg:pb-0">
          <section className="lg:max-w-md">
            <h1 className="text-4xl leading-[1.05] font-semibold tracking-[-0.04em] text-balance sm:text-5xl">
              From webhook to lock screen.
            </h1>
            <p className="mt-5 max-w-md text-base leading-relaxed text-pretty text-ink-subtle sm:text-lg">
              Hark turns events from webhooks, coding agents, scripts, and CI into Android
              notifications and live progress updates, delivered directly through FCM.
            </p>
            {!session ? (
              <div className="mt-8 hidden flex-wrap gap-3 lg:flex">
                <GoogleButton onClick={() => void signInWithGoogle()} disabled={isPending} />
              </div>
            ) : null}
          </section>
          <div className="flex justify-center">
            <div className="w-full max-w-md rounded-[28px] border border-line bg-surface p-6 shadow-xl">
              <div className="flex items-center justify-between text-xs text-ink-faint">
                <span>Hark · CI</span>
                <span>now</span>
              </div>
              <p className="mt-4 text-base font-semibold text-ink">Deploy #184</p>
              <p className="mt-1 text-sm text-ink-subtle">Tests passed. Ready to ship.</p>
              <div className="mt-5 h-1.5 overflow-hidden rounded-full bg-surface-muted">
                <div className="h-full w-4/5 rounded-full bg-accent" />
              </div>
              <div className="mt-5 flex gap-2 text-xs font-medium">
                <span className="rounded-full bg-accent-soft px-3 py-1.5 text-accent-text">
                  Approve
                </span>
                <span className="rounded-full bg-surface-muted px-3 py-1.5 text-ink-muted">
                  Deny
                </span>
              </div>
            </div>
          </div>
          {!session ? (
            <div className="flex flex-wrap justify-center gap-3 lg:hidden">
              <GoogleButton onClick={() => void signInWithGoogle()} disabled={isPending} />
            </div>
          ) : null}
        </div>
      </main>
    </div>
  );
}
