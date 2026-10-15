import {
  attributionSpend,
  adsMetric,
  adsMetricDefinitions,
} from "./adsPresentation.js";
import DataTable from "../../components/tables/DataTable.jsx";
export default function AdsReportingContext({ report, brands }) {
  const rows = attributionSpend(report);
  const coverage = report?.insights?.scope_coverage;
  return (
    <div className="space-y-3 mt-4">
      {coverage && (
        <p className="text-sm text-text-secondary">
          Reported campaign spend:{" "}
          {adsMetric(
            { value: coverage.reported_spend },
            "spend",
            report.account.currency,
          )}
          {" · "}
          {coverage.reported_campaigns}/{coverage.campaigns} confirmed campaigns
          with insight rows.
          {coverage.spend_campaigns < coverage.campaigns &&
            " Complete brand totals are unavailable; missing data is not zero."}
        </p>
      )}
      {rows.length > 0 && (
        <details open className="ads-attribution-coverage">
          <summary className="font-semibold">
            Campaign attribution · reported spend
          </summary>
          <DataTable
            density="compact"
            mobileLayout="stack"
            minWidth={480}
            rows={rows}
            getRowKey={(r) => r.brand_id || "unassigned"}
            columns={[
              {
                key: "brand_id",
                header: "Brand",
                render: (r) =>
                  r.brand_id
                    ? brands.find((b) => b.id === r.brand_id)?.name ||
                      "Brand unavailable"
                    : "Unassigned",
              },
              {
                key: "reported_spend",
                header: "Reported spend",
                render: (r) =>
                  adsMetric(
                    { value: r.reported_spend },
                    "spend",
                    report.account.currency,
                  ),
              },
              {
                key: "coverage",
                header: "Coverage",
                render: (r) =>
                  `${r.reported_campaigns}/${r.campaigns} campaigns with insight rows`,
              },
            ]}
          />
          <p className="text-xs text-text-secondary mt-2">
            Only returned campaign insight rows are included. Missing rows
            remain unavailable; these subtotals may not reconcile with Meta
            account totals. Unassigned campaigns are visible only at
            the shared account level.
          </p>
        </details>
      )}
      <details>
        <summary className="text-sm">
          Metric definitions & reporting limits
        </summary>
        <dl className="text-xs space-y-1">
          {Object.entries(adsMetricDefinitions).map(([key, text]) => (
            <div key={key}>
              <dt className="font-semibold">{key.toUpperCase()}</dt>
              <dd>{text}</dd>
            </div>
          ))}
        </dl>
        <p className="text-xs mt-2">
          Results retain each Meta action type and its ad-set attribution
          settings. Cost per Result uses the same action type. Metrics may be
          delayed or revised; conversions are not verified FeedX sales or
          incremental revenue. A dash means unavailable.
        </p>
      </details>
    </div>
  );
}
