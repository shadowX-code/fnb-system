import { useEffect, useRef, useState } from "react";
import { adsService } from "./adsService.js";
import Badge from "../../components/ui/Badge.jsx";
export default function AdsCopilot({
  org,
  brand,
  account,
  from,
  to,
  canGenerate,
  canReview,
}) {
  const [usage, setUsage] = useState(null),
    [available, setAvailable] = useState(false),
    [runs, setRuns] = useState([]),
    [packet, setPacket] = useState(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [refresh, setRefresh] = useState(0);
  const generation = useRef(0);
  useEffect(() => {
    const seq = ++generation.current;
    setPacket(null);
    setRuns([]);
    setUsage(null);
    setError("");
    if (!brand) return;
    Promise.all([
      adsService.aiCapabilities(),
      adsService.aiRead(org, brand),
      adsService.copilotPrepare(org, brand, from, to),
      adsService.aiUsage(org, brand),
    ])
      .then(([config, rows, evidence, totals]) => {
        if (seq === generation.current) {
          setAvailable(config.ai_available);
          setRuns(rows);
          setPacket(evidence);
          setUsage(totals);
        }
      })
      .catch((e) => {
        if (seq === generation.current) setError(e.message);
      });
    return () => {
      generation.current++;
    };
  }, [org, brand, from, to, refresh]);
  async function perform(action) {
    const seq = generation.current;
    setBusy(true);
    setError("");
    try {
      await action();
      if (seq === generation.current) setRefresh((v) => v + 1);
    } catch (e) {
      if (seq === generation.current) setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="ads-panel space-y-4">
      <div>
        <h2 className="font-semibold">AI Ads Copilot</h2>
        <p className="text-sm text-text-secondary">
          Advisory proposals grounded in approved brand facts and observed Meta
          performance. Human review does not authorize spending.
        </p>
      </div>
      {!brand ? (
        <p>Select a brand with confirmed campaigns.</p>
      ) : (
        <>
          {error && (
            <p role="alert" className="text-sm text-text-secondary">
              {error}
            </p>
          )}
          {packet && (
            <p className="text-sm">
              {packet.brand_context_available
                ? `Approved Brand Knowledge revision ${packet.knowledge_revision}`
                : "Brand context unavailable · generic performance advice only"}{" "}
              · {from}–{to}
            </p>
          )}
          {!available && (
            <p className="text-sm text-text-secondary">
              Ads AI provider is not enabled.
            </p>
          )}
          {canGenerate && (
            <button
              className="btn-primary"
              disabled={busy || !packet || !available || !account}
              onClick={() =>
                perform(() =>
                  adsService.copilot(
                    org,
                    brand,
                    account,
                    from,
                    to,
                    crypto.randomUUID(),
                  ),
                )
              }
            >
              {busy ? "Preparing…" : "Generate recommendations"}
            </button>
          )}
          {usage && (
            <p className="text-xs text-text-secondary">
              Ads Copilot · {usage.period}: {usage.requests} requests ·{" "}
              {usage.input_tokens ?? "unavailable"} input /{" "}
              {usage.output_tokens ?? "unavailable"} output tokens ·{" "}
              {usage.estimated_cost_usd == null
                ? "Cost unavailable"
                : `Estimated USD ${Number(usage.estimated_cost_usd).toFixed(6)}`}{" "}
              · {usage.cost_unavailable_requests} requests without cost evidence
            </p>
          )}
          {runs.map((run) => (
            <article
              key={run.id}
              className="border-t border-border pt-4 space-y-3"
            >
              <div className="flex flex-wrap justify-between gap-2">
                <Badge>
                  {run.state === "proposed"
                    ? run.reviewed_at
                      ? "Reviewed · advisory"
                      : "Needs human review"
                    : run.state === "generating"
                      ? "Generating · refresh for outcome"
                      : run.state}
                </Badge>
                <small>
                  {run.date_from}–{run.date_to}
                </small>
              </div>
              {run.proposal && (
                <>
                  <p className="text-sm">{run.proposal.summary}</p>
                  {run.proposal.recommendations.map((r, i) => (
                    <section key={i} className="space-y-2">
                      <h3 className="font-semibold">{r.title}</h3>
                      <Badge>{r.category} proposal</Badge>
                      <p className="text-sm">{r.proposal}</p>
                      <p className="text-xs text-text-secondary">{r.caution}</p>
                      <details>
                        <summary className="text-sm">
                          Supporting evidence
                        </summary>
                        <ul className="space-y-1 text-xs">
                          {r.evidence.map((e) => (
                            <li key={e.key}>
                              {e.kind === "approved_brand_fact"
                                ? e.value
                                : `${e.campaign || e.campaign_id} · ${e.metric || e.type}: ${e.value} ${["spend", "cpc", "cpm"].includes(e.metric) ? e.currency : ""} · ${e.state || "Meta result"} · ${e.from}–${e.to}`}{" "}
                              {e.timezone || ""}
                            </li>
                          ))}
                        </ul>
                      </details>
                    </section>
                  ))}
                </>
              )}
              <p className="text-xs text-text-secondary">
                {run.provider_model || "Model unavailable"} · Tokens:{" "}
                {run.input_tokens ?? "unavailable"} in /{" "}
                {run.output_tokens ?? "unavailable"} out ·{" "}
                {run.cost_usd == null
                  ? "Cost unavailable"
                  : `Estimated USD ${Number(run.cost_usd).toFixed(6)}`}{" "}
                {run.cost_basis || ""}
              </p>
              {run.state === "stale" && (
                <p className="text-sm">
                  Evidence or authorization changed. Prepare a new
                  recommendation.
                </p>
              )}
              {canReview && run.state === "proposed" && !run.reviewed_at && (
                <button
                  className="btn-secondary"
                  disabled={busy}
                  onClick={() => perform(() => adsService.aiReview(run.id))}
                >
                  Mark reviewed · no execution
                </button>
              )}
            </article>
          ))}
          <button
            className="btn-secondary"
            disabled={busy}
            onClick={() => setRefresh((v) => v + 1)}
          >
            Refresh recommendations
          </button>
        </>
      )}
    </section>
  );
}
