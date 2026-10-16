import AdminFilterToolbar from "../../components/layout/AdminFilterToolbar.jsx";
import { useMemo, useState } from "react";
import DataTable from "../../components/tables/DataTable.jsx";
import AdminSearchField from "../../components/forms/AdminSearchField.jsx";
import SelectField from "../../components/forms/SelectField.jsx";
import Modal from "../../components/feedback/Modal.jsx";
import Badge from "../../components/ui/Badge.jsx";
import EmptyState from "../../components/feedback/EmptyState.jsx";
import { campaignEvidence, attributionGroups } from "./adsAttribution.js";
import { adsService } from "./adsService.js";
import { adsMetric, insightFor } from "./adsPresentation.js";
import { adsMetricAvailability } from "./adsHistory.js";
const evidenceLabels = {verified:'Verified identities',partial:'Partial identities',unavailable:'Identity unavailable',conflict:'Conflicting identities',unmatched:'Brand unverified'};
export default function AdsAttributionReview({
  report,
  org,
  brands,
  identities,
  canManage,
  onUpdated,
  from,
  to,
}) {
  const [search, setSearch] = useState(""),
    [filter, setFilter] = useState("all"),
    [page, setPage] = useState(1),
    [selected, setSelected] = useState([]),
    [confirmation, setConfirmation] = useState(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const rows = useMemo(
    () => campaignEvidence(report, brands, identities),
    [report, brands, identities],
  );
  const groups = attributionGroups(rows);
  const filtered = rows.filter(
    (c) =>
      (filter === "all" || c.evidence.key === filter) &&
      (!search ||
        c.name.toLowerCase().includes(search.toLowerCase()) ||
        c.id.includes(search)),
  );
  const visible = filtered.slice((page - 1) * 15, page * 15);
  const name = (id) => brands.find((b) => b.id === id)?.name || "Unassigned";
  const propose = (items) => {
    setError("");
    setConfirmation({
      items,
      brand: items.length && items.every(c=>c.evidence.ready && c.evidence.matches[0]===items[0].evidence.matches[0]) ? items[0].evidence.matches[0] : "",
      request: crypto.randomUUID(),
      rows: items.map((c) => ({
        campaign_id: c.id,
        revision: c.feedx_attribution_revision || 0,
        request_id: crypto.randomUUID(),
      })),
    });
  };
  const selection = rows.filter((c) => selected.includes(c.id));
  const proposedBrand = confirmation?.items.length && confirmation.items.every(c=>c.evidence.ready&&c.evidence.matches[0]===confirmation.items[0].evidence.matches[0]) ? confirmation.items[0].evidence.matches[0] : '';
  const canConfirm = confirmation && (proposedBrand && confirmation.brand===proposedBrand || confirmation.brand==='' && confirmation.items.some(c=>c.feedx_brand_id));
  const period = `${report.date_from||from||'Unknown start'}–${report.date_to||to||'Unknown end'}`;
  const spend = c => {
    const row=insightFor(report,'campaign',c.id),metric=row?.metrics?.spend;
    return <span className="block tabular-nums"><strong>{adsMetric(metric,'spend',report.account.currency)}</strong>{metric?.value==null&&<small className="block text-text-secondary">{adsMetricAvailability(report,'campaign',row)||'Spend unavailable'}</small>}</span>;
  };
  const coverage = c => <span className="block"><span className="tabular-nums">{c.evidence.known}/{c.evidence.total} ads with identity</span><small className="block text-text-secondary">{evidenceLabels[c.evidence.status]}</small></span>;
  const safeBatch =
    selection.length > 0 &&
    selection.every((c) => c.evidence.key === selection[0].evidence.key) &&
    groups.find((g) => g.key === selection[0].evidence.key)?.batchable;
  const evidence = (c) => (
    <>
      <span className="block text-xs">
        {c.evidence.pages.length
          ? `Page ${c.evidence.pages.join(", ")}`
          : "Page unavailable"}
        {c.evidence.instagram.length
          ? ` · Instagram ${c.evidence.instagram.join(", ")}`
          : ""}
      </span>
      <small className="text-text-secondary">
        {c.evidence.matches.length
          ? `Connected identity match: ${c.evidence.matches.map(name).join(", ")} (confirm required)`
          : c.evidence.hints.length
            ? `Name suggestion: ${c.evidence.hints.map(name).join(", ")} (unverified)`
            : "No verified FeedX brand match"}
      </small>
    </>
  );
  const select = (c) => (
    <input
      type="checkbox"
      aria-label={`Select ${c.name}`}
      checked={selected.includes(c.id)}
      disabled={!c.evidence.ready}
      onChange={(e) =>
        setSelected(
          e.target.checked
            ? [...selected, c.id]
            : selected.filter((id) => id !== c.id),
        )
      }
    />
  );
  return (
    <div className="space-y-4 mt-4">
      <AdminFilterToolbar compact denseFields ariaLabel="Attribution filters">
        <AdminSearchField
          label="Search campaigns"
          value={search}
          onChange={(value) => {
            setSearch(value);
            setPage(1);
          }}
          placeholder="Campaign name or ID"
        />
        <SelectField
          className="min-w-0"
          label="Evidence group"
          value={filter}
          onChange={(v) => {
            setFilter(v);
            setPage(1);
          }}
          options={[
            { value: "all", label: "All" },
            ...groups.map((g) => ({
              value: g.key,
              label: `${g.label} (${g.rows.length})`,
            })),
          ]}
        />
        {canManage && (
          <button
            className="btn-secondary"
            disabled={!safeBatch}
            onClick={() => propose(selection)}
          >
            Review selected ({selected.length})
          </button>
        )}
      </AdminFilterToolbar>
      <p className="text-xs text-text-secondary">
        Spend: {period} · {report.account.currency} · {report.account.timezone||'Account timezone unavailable'}. Only complete, consistent ad identities matched to one connected Brand can be assigned. Partial or unavailable evidence stays Unassigned. Names never establish ownership.
      </p>
      {error && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}
      {!filtered.length ? (
        <EmptyState title="No matching campaigns" />
      ) : (
        <>
          <div className="ads-desktop">
            <DataTable
              density="compact"
              minWidth={900}
              rows={visible}
              getRowKey={(c) => c.id}
              columns={[
                ...(canManage
                  ? [{ key: "select", header: "Select", render: select }]
                  : []),
                {
                  key: "name",
                  header: "Campaign",
                  render: (c) => (
                    <>
                      <strong>{c.name}</strong>
                      <small className="block text-text-secondary">
                        {c.id}
                      </small>
                    </>
                  ),
                },
                {
                  key: 'spend', header: 'Selected-period spend', render:spend,
                },
                {
                  key:'coverage',header:'Ad identity coverage',render:coverage,
                },
                {
                  key: "brand",
                  header: "FeedX brand",
                  render: (c) => name(c.feedx_brand_id),
                },
                {
                  key: "evidence",
                  header: "Ownership evidence",
                  render: evidence,
                },
                {
                  key: "status",
                  header: "Meta status",
                  render: (c) => <Badge>{c.effective_status}</Badge>,
                },
                ...(canManage
                  ? [
                      {
                        key: "review",
                        header: "Review",
                        render: (c) => (
                          <button
                            className="btn-secondary"
                            onClick={() => propose([c])}
                          >
                            Review
                          </button>
                        ),
                      },
                    ]
                  : []),
              ]}
            />
          </div>
          <div className="ads-mobile">
            {visible.map((c) => (
              <section key={c.id} className="ads-panel space-y-2">
                <div className="flex gap-2">
                  {canManage && select(c)}
                  <strong className="break-words">{c.name}</strong>
                </div>
                <div className="flex justify-between gap-2">
                  <span>{name(c.feedx_brand_id)}</span>
                  <Badge>{c.effective_status}</Badge>
                </div>
                {evidence(c)}
                <div><small className="text-text-secondary">Selected-period spend</small>{spend(c)}</div>
                {coverage(c)}
                {canManage && (
                  <button
                    className="btn-secondary"
                    onClick={() => propose([c])}
                  >
                    Review attribution
                  </button>
                )}
              </section>
            ))}
          </div>
          <div className="flex flex-wrap justify-between gap-2 text-sm">
            <span>
              {(page - 1) * 15 + 1}–{Math.min(page * 15, filtered.length)} of{" "}
              {filtered.length}
            </span>
            <div className="flex gap-2">
              <button
                className="btn-secondary"
                disabled={page === 1}
                onClick={() => setPage(page - 1)}
              >
                Previous
              </button>
              <button
                className="btn-secondary"
                disabled={page * 15 >= filtered.length}
                onClick={() => setPage(page + 1)}
              >
                Next
              </button>
            </div>
          </div>
        </>
      )}
      {confirmation && (
        <Modal
          title={`Confirm attribution · ${confirmation.items.length} campaign${confirmation.items.length === 1 ? "" : "s"}`}
          size="xl"
          onClose={() => !busy && setConfirmation(null)}
          footer={
            <button
              className="btn-primary"
              disabled={busy||!canConfirm}
              onClick={async () => {
                if(!canConfirm)return;
                setBusy(true);
                setError("");
                try {
                  await adsService.attributeBatch(
                    org,
                    report.account.id,
                    confirmation.rows,
                    confirmation.brand,
                    confirmation.request,
                  );
                  setConfirmation(null);
                  setSelected([]);
                  onUpdated();
                } catch (e) {
                  setError(e.message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              Confirm selected attribution
            </button>
          }
        >
          <p className="text-sm mb-3">
            This changes FeedX brand visibility and inherited Ad Set/Ad
            reporting. Meta campaigns and budgets stay unchanged. All selected
            revisions must still match.
          </p>
          <SelectField
            label="Confirmed FeedX brand"
            value={confirmation.brand}
            onChange={(brand) =>
              setConfirmation({
                ...confirmation,
                brand,
                request: crypto.randomUUID(),
                rows: confirmation.rows.map((r) => ({
                  ...r,
                  request_id: crypto.randomUUID(),
                })),
              })
            }
            options={[
              { value: "", label: "Unassigned" },
              ...brands.filter(b=>b.id===proposedBrand).map((b) => ({ value: b.id, label: b.name })),
            ]}
          />
          <p className="my-3 text-sm text-text-secondary">Selected period: {period}. Unavailable spend is not zero; attribution never distributes shared-account spend.</p>
          {!proposedBrand&&<p role="status" className="my-3 text-sm text-text-secondary">Identity evidence is incomplete or does not resolve to one Brand. Keep this campaign Unassigned until verified. Existing assignments can be cleared explicitly.</p>}
          <div className="ads-desktop">
            <DataTable density="compact" minWidth={760} rows={confirmation.items} getRowKey={c=>c.id} columns={[
              {key:'campaign',header:'Campaign',render:c=><><strong>{c.name}</strong><small className="block text-text-secondary">{c.id}</small></>},
              {key:'spend',header:'Selected-period spend',render:spend},
              {key:'coverage',header:'Ad identity coverage',render:coverage},
              {key:'brand',header:'Proposed Brand',render:()=>name(confirmation.brand)},
              {key:'evidence',header:'Evidence',render:evidence},
            ]}/>
          </div>
          <div className="ads-mobile space-y-3">
            {confirmation.items.map(c=><section key={c.id} className="ads-panel space-y-2"><strong className="break-words">{c.name}</strong><small className="block text-text-secondary">{c.id}</small><div><small className="text-text-secondary">Selected-period spend</small>{spend(c)}</div>{coverage(c)}<p>Proposed Brand: {name(confirmation.brand)}</p>{evidence(c)}</section>)}
          </div>
          {error && (
            <p role="alert" className="text-red-600 text-sm">
              {error}
            </p>
          )}
        </Modal>
      )}
    </div>
  );
}
