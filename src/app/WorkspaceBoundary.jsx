import { Component, Suspense } from "react";
import FeedXLoadingMark from "../features/crew/components/FeedXLoadingMark.jsx";

export default class WorkspaceBoundary extends Component {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    const crew = this.props.workspace === "crew";
    const frame = crew ? "crew-v2-shell" : "flex min-h-screen items-center justify-center bg-app-bg px-4";
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
