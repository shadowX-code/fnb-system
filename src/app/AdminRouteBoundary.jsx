import { Component, Suspense } from "react";

function AdminRouteLoading({ label }) {
  return (
    <section className="card min-h-64 p-6" role="status" aria-live="polite" aria-busy="true">
      <p className="text-sm font-semibold text-text-secondary">Loading {label || "page"}…</p>
    </section>
  );
}

// Do not key this boundary by route: Factory/Inventory retain their existing
// component lifetime when navigating between routes owned by the same feature.
export default class AdminRouteBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { failed: false, routeKey: props.routeKey };
  }

  static getDerivedStateFromError() {
    return { failed: true };
  }

  static getDerivedStateFromProps(props, state) {
    return props.routeKey !== state.routeKey ? { failed: false, routeKey: props.routeKey } : null;
  }

  render() {
    if (this.state.failed) {
      return (
        <section className="card min-h-64 p-6" role="alert">
          <h2 className="text-lg font-semibold text-text-primary">Unable to open this page</h2>
          <p className="mt-2 text-sm text-text-secondary">Check your connection and reload to try again. You can also open another page from the menu.</p>
          <button className="btn-primary mt-4" type="button" onClick={() => window.location.reload()}>Reload page</button>
        </section>
      );
    }
    return <Suspense fallback={<AdminRouteLoading label={this.props.label} />}>{this.props.children}</Suspense>;
  }
}
