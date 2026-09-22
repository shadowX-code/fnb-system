import { Component, lazy, Suspense } from "react";
import FeedXLoadingMark from "../features/crew/components/FeedXLoadingMark.jsx";

const CrewRecoverySurface = lazy(() => import("../features/crew/components/CrewRecoverySurface.jsx"));

const lazyLoadFailure = (error) => /dynamically imported module|importing a module script failed|loading chunk|chunkloaderror/i.test(String(error?.message || ""));
const reloadKey = "feedx.crew.lazy-reload";

export default class WorkspaceBoundary extends Component {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error) {
    if (this.props.workspace !== "crew" || !lazyLoadFailure(error)) return;
    try {
      if (sessionStorage.getItem(reloadKey) === "1") return;
      sessionStorage.setItem(reloadKey, "1");
      window.location.reload();
    } catch {
      // The visible recovery surface remains available when reload is blocked.
    }
  }

  render() {
    const crew = this.props.workspace === "crew";
    const frame = crew ? "crew-v2-shell" : "flex min-h-screen items-center justify-center bg-app-bg px-4";
    if (this.state.failed && crew) {
      return <Suspense fallback={<main className={frame} aria-busy="true"><section className="crew-v2-app"><div className="crew-v2-state"><FeedXLoadingMark /></div></section></main>}>
        <CrewRecoverySurface mode="entry" onReload={() => window.location.reload()} />
      </Suspense>;
    }
    if (this.state.failed) {
      return <main className={frame}><section className="card p-6" role="alert">
        <h1 className="text-lg font-semibold">Unable to open FeedX</h1>
        <p className="mt-2 text-sm text-text-secondary">Check your connection and reload to try again.</p>
        <button className="btn-primary mt-4" type="button" onClick={() => window.location.reload()}>Reload page</button>
      </section></main>;
    }
    const fallback = <main className={frame} aria-busy="true">
      {crew ? <section className="crew-v2-app"><div className="crew-v2-state"><FeedXLoadingMark /></div></section>
        : <div className="card p-6 text-sm font-semibold text-text-secondary" role="status">Loading workspace…</div>}
    </main>;
    return <Suspense fallback={fallback}>{this.props.children}</Suspense>;
  }
}
