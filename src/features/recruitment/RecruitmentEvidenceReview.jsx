import { useEffect, useRef, useState } from "react";
import Modal from "../../components/feedback/Modal.jsx";
import StatusBadge from "../../components/ui/StatusBadge.jsx";
import { RecruitmentState } from "./RecruitmentPresentation.jsx";
import {
  reviewAreas,
  fitLabels,
  coverageLabels,
} from "./reviewIntelligence.js";
import { explicitRequirements } from "../../../supabase/functions/recruitment-report/report.ts";
import AdminFormField from "../../components/forms/AdminFormField.jsx";
import DatePickerField from "../../components/forms/DatePickerField.jsx";
import { recruitmentService } from "./recruitmentService.js";
const label = {
  candidate_stated: "Candidate-stated",
  interpretation: "AI interpretation",
  unresolved: "Unresolved",
};
const decisionLabels = {
  review: "Awaiting review",
  shortlisted: "Shortlisted",
  final_interview: "Final interview",
  rejected: "Rejected",
  hired: "Hired",
};
function Finding({ finding, showTurn, showRecording }) {
  return (
    <div className="my-2">
      <p>
        <span className="mr-2 text-xs font-semibold text-text-muted">
          {label[finding.kind]}
        </span>
        {finding.text}
      </p>
      <div className="mt-1 flex flex-wrap gap-2">
        {finding.evidence?.map((e) => (
          <span
            key={e.turn_id}
            className="inline-flex flex-wrap items-center gap-2"
          >
            <button
              className="text-sm underline"
              onClick={() => showTurn(e.turn_id)}
            >
              Turn {e.turn_number}
            </button>
            {(e.recordings || []).map((r) => (
              <button
                key={r.unit_id}
                className="text-sm underline"
                onClick={() => showRecording(r)}
              >
                Recording {r.sequence} · ~{Math.round(r.offset_seconds)}s
              </button>
            ))}
            {!e.recordings?.length && (
              <span className="text-xs text-text-muted">
                Recording correspondence unavailable
              </span>
            )}
          </span>
        ))}
      </div>
    </div>
  );
}
export default function RecruitmentEvidenceReview({
  application,
  onClose,
  onChanged,
}) {
  const [data, setData] = useState(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [reportId, setReportId] = useState(""),
    [focusTurn, setFocusTurn] = useState(null),
    [decision, setDecision] = useState(""),
    [reason, setReason] = useState("");
  const [hire, setHire] = useState({
    full_name: application.name,
    contact: application.contact,
    nationality: "",
    ic_no: "",
    employment_type: "probation",
    joined_date: "",
    duplicate_name_reason: "",
  });
  const [attemptId, setAttemptId] = useState(null);
  const transcriptSection = useRef(null),
    recordingSection = useRef(null),
    decisionSection = useRef(null);
  const retry = useRef(null),
    turnRefs = useRef({}),
    videoRefs = useRef({});
  const load = async () => {
    const d = await recruitmentService.managerEvidence(
      application.id,
      attemptId,
    );
    setData(d);
    return d;
  };
  useEffect(() => {
    let active = true;
    recruitmentService
      .managerEvidence(application.id, attemptId)
      .then((d) => {
        if (active) setData(d);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [application.id, attemptId]);
  const report =
    data?.reports.find((r) => r.id === reportId) || data?.reports[0];
  const source = report?.source_snapshot;
  const turns = source?.turns || data?.turns || [],
    scenarios =
      source?.config.scenario_briefs ||
      data?.scenarios.map((s) => s.brief) ||
      [];
  async function act(fn) {
    setError("");
    setBusy(true);
    try {
      await fn();
      await load();
      onChanged?.();
    } catch (e) {
      setError(e.message || "Unable to save.");
    } finally {
      setBusy(false);
    }
  }
  async function generate(newVersion = false) {
    await act(async () => {
      await recruitmentService.generateReport(
        application.id,
        crypto.randomUUID(),
        newVersion,
        attemptId,
      );
    });
  }
  function showTurn(id) {
    if (transcriptSection.current) transcriptSection.current.open = true;
    setFocusTurn(id);
    requestAnimationFrame(() => {
      turnRefs.current[id]?.scrollIntoView({ block: "center" });
      turnRefs.current[id]?.focus({ preventScroll: true });
    });
  }
  function showRecording(ref) {
    if (recordingSection.current) recordingSection.current.open = true;
    const video = videoRefs.current[ref.unit_id];
    if (video) {
      video.scrollIntoView({ behavior: "smooth", block: "center" });
      video.currentTime = ref.offset_seconds;
    }
  }

  async function saveDecision() {
    await act(async () => {
      const payload = {
        applicationId: application.id,
        expectedState: data.application.decision_state,
        decision,
        reason,
        hire: decision === "hired" ? hire : null,
        reportId: ["ready", "unusable"].includes(report?.status)
          ? report.id
          : null,
      };
      const fingerprint = JSON.stringify(payload);
      if (retry.current?.fingerprint !== fingerprint)
        retry.current = { fingerprint, id: crypto.randomUUID() };
      await recruitmentService.decide({
        ...payload,
        requestId: retry.current.id,
      });
      setDecision("");
      setReason("");
      retry.current = null;
    });
  }
  const finalized = ["completed", "partial", "failed"].includes(
      data?.attempt?.status,
    ),
    state = data?.application.decision_state;
  const areas = data ? reviewAreas(data, report) : [];
  const requirements = explicitRequirements(
    source?.config || { opening_requirements: data?.opening_requirements },
  );
  const patchHire = (k, v) => setHire((h) => ({ ...h, [k]: v }));
  return (
    <Modal
      title="Application review"
      size="3xl"
      panelClassName="recruitment-review"
      bodyClassName="!p-0"
      onClose={onClose}
      footer={
        <>
          <button
            className="btn-secondary"
            disabled={busy}
            onClick={() => act(async () => {})}
          >
            Refresh evidence
          </button>
          {data && (
            <button
              className="btn-primary"
              onClick={() => {
                decisionSection.current?.scrollIntoView({ block: "start" });
                decisionSection.current?.focus({ preventScroll: true });
              }}
            >
              Manager decision
            </button>
          )}
        </>
      }
    >
      {error && (
        <p role="alert" className="mb-4 text-red-700">
          {error}
        </p>
      )}
      {!data ? (
        <p>Loading application…</p>
      ) : (
        <div className="recruitment-review-content">
          <nav
            className="recruitment-review-nav"
            aria-label="Application review sections"
          >
            {[
              ["review-summary", "Summary"],
              ["opening-requirements-heading", "Requirements"],
              ["interview-evidence-heading", "Evidence"],
              ["review-followup", "Follow-up"],
              ["review-original", "Original evidence"],
              ["review-decision", "Manager decision"],
            ].map(([id, text]) => (
              <button
                key={id}
                type="button"
                onClick={() => {
                  const target = document.getElementById(id);
                  target?.scrollIntoView({ block: "start" });
                  target?.focus({ preventScroll: true });
                }}
              >
                {text}
              </button>
            ))}
          </nav>
          <div className="recruitment-review-main">
            <header className="space-y-2 border-b border-border pb-5">
              {data.attempts.length > 1 && (
                <AdminFormField label="Interview attempt">
                  <select
                    className="control w-full"
                    value={data.attempt?.id || ""}
                    onChange={(e) => {
                      setReportId("");
                      setAttemptId(e.target.value);
                      setData(null);
                    }}
                  >
                    {data.attempts.map((t, i) => (
                      <option key={t.id} value={t.id}>
                        {i === 0 ? "Latest" : "Earlier"} · {t.status} ·{" "}
                        {new Date(t.created_at).toLocaleString()}
                      </option>
                    ))}
                  </select>
                </AdminFormField>
              )}
              <h3 className="text-lg font-semibold">
                {data.attempt?.profile_name || data.candidate.full_name}
              </h3>
              <p>
                {data.application.opening_title_snapshot} ·{" "}
                {data.application.workplace_snapshot}
              </p>
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <RecruitmentState value={data.attempt?.status || "registered"}>
                  {data.attempt?.status?.replaceAll("_", " ") || "Not started"}
                </RecruitmentState>
                <span className="text-text-secondary">
                  {decisionLabels[state]}
                </span>
                <span className="text-text-muted">
                  · Recording: {data.attempt?.recording_state || "not started"}
                </span>
                <span className="text-text-muted">
                  ·{" "}
                  {
                    data.events.filter((e) => e.action === "recording_gap")
                      .length
                  }{" "}
                  disclosed gaps
                </span>
                {data.units.some((u) => u.status === "invalid") && (
                  <StatusBadge tone="warning">
                    Recording unit unavailable
                  </StatusBadge>
                )}
              </div>
              <p className="text-sm text-text-secondary">
                Transcript{" "}
                {data.annotations.some((a) => a.kind === "transcription_failed")
                  ? "has disclosed gaps"
                  : data.turns.some((t) => t.speaker === "candidate")
                    ? "available"
                    : "unavailable"}
                . Evidence coverage describes what is understood; requirement
                fit is assessed separately.
              </p>
            </header>
            {!data.launch_ready && (
              <p
                role="status"
                className="rounded-lg bg-surface-muted p-3 text-sm"
              >
                Not ready for real candidate collection: approved consent copy
                is still required. Synthetic QA only.
              </p>
            )}
            <section id="review-summary" tabIndex={-1}>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h3 className="font-semibold">AI Interview Summary</h3>
                {data.reports.length > 1 && (
                  <select
                    aria-label="Report version"
                    className="control"
                    value={report?.id || ""}
                    onChange={(e) => setReportId(e.target.value)}
                  >
                    {data.reports.map((r) => (
                      <option key={r.id} value={r.id}>
                        Version {r.version} · {r.status}
                        {r.reviews ? " · reviewed" : ""}
                      </option>
                    ))}
                  </select>
                )}
              </div>
              {!report ? (
                <p className="my-3 text-text-secondary">
                  {finalized
                    ? "Generate the evidence report for this finalized interview."
                    : "The report becomes available after the interview is finalized."}
                </p>
              ) : (
                <>
                  <p className="my-2 text-xs text-text-muted">
                    Version {report.version} · {report.status} ·{" "}
                    {new Date(report.created_at).toLocaleString()}
                    {report.reviews ? " · Manager reviewed" : ""} · Evidence
                    pinned to this version
                  </p>
                  {report.status === "ready" ? (
                    <>
                      <ul className="my-3 space-y-2 text-sm leading-relaxed max-w-[75ch]">
                        {report.body.candidate_snapshot
                          .filter((f) => f.kind === "candidate_stated")
                          .map((f, i) => (
                            <li key={i}>{f.text}</li>
                          ))}
                      </ul>
                      {!report.body.candidate_snapshot.some(
                        (f) => f.kind === "candidate_stated",
                      ) && (
                        <p className="text-sm text-text-secondary">
                          No factual candidate snapshot established.
                        </p>
                      )}
                      <details className="text-sm text-text-secondary">
                        <summary className="cursor-pointer py-2">
                          Summary sources
                        </summary>
                        {report.body.candidate_snapshot
                          .filter((f) => f.kind === "candidate_stated")
                          .map((f, i) => (
                            <Finding
                              key={i}
                              finding={f}
                              showTurn={showTurn}
                              showRecording={showRecording}
                            />
                          ))}
                      </details>
                    </>
                  ) : report.status === "unusable" ? (
                    <p>{report.body.unusable_reason}</p>
                  ) : (
                    <p>
                      {report.status === "failed"
                        ? "Report generation failed. Transcript and recordings remain available."
                        : "Report generation is queued or in progress. Refresh or continue generation."}
                    </p>
                  )}
                </>
              )}
              {finalized && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {(!report ||
                    ["queued", "generating"].includes(report.status)) && (
                    <button
                      disabled={busy}
                      className="btn-secondary"
                      onClick={() => generate()}
                    >
                      {busy ? "Generating…" : "Generate interview report"}
                    </button>
                  )}
                  {["ready", "unusable"].includes(report?.status) &&
                    data.can_manage && (
                      <button
                        className="btn-secondary"
                        disabled={busy}
                        onClick={() => generate(true)}
                      >
                        Generate new version
                      </button>
                    )}
                  {["ready", "unusable"].includes(report?.status) &&
                    data.can_manage && (
                      <button
                        className="btn-secondary"
                        disabled={busy || !!report.reviews}
                        onClick={() =>
                          act(() => recruitmentService.reviewReport(report.id))
                        }
                      >
                        {report.reviews ? "Reviewed" : "Mark report reviewed"}
                      </button>
                    )}
                </div>
              )}
            </section>
            <section
              id="review-requirements"
              tabIndex={-1}
              aria-labelledby="opening-requirements-heading"
            >
              <h3
                tabIndex={-1}
                id="opening-requirements-heading"
                className="text-base font-semibold"
              >
                Opening Requirements
              </h3>
              <p className="mt-1 text-sm text-text-muted">
                Evidence fit for this opening only. Covered evidence can still
                conflict with a requirement.
              </p>
              {!requirements.length && (
                <p className="mt-3 text-sm text-text-secondary">
                  No explicit opening requirements configured.
                </p>
              )}
              <div className="mt-3 divide-y divide-border">
                {requirements.map((r) => {
                  const fit =
                    report?.status === "ready"
                      ? report.body.opening_requirements?.find(
                          (f) => f.key === r.key,
                        )
                      : null;
                  return (
                    <div key={r.key} className="py-3">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <p className="font-medium text-sm">{r.requirement}</p>
                        <RecruitmentState
                          kind="fit"
                          value={fit?.state || "unclear"}
                        />
                      </div>
                      <p className="mt-1 text-sm text-text-secondary">
                        {fit?.finding.text ||
                          (report?.status === "ready"
                            ? "This historical report does not assess requirement fit. Generate a new version to evaluate cited evidence."
                            : "Requirement fit awaits a finalized evidence report; no fit is inferred from coverage.")}
                      </p>
                      {fit?.finding.evidence.length > 0 && (
                        <details className="mt-1 text-sm">
                          <summary className="cursor-pointer py-1 text-text-secondary">
                            Supporting evidence · {fit.finding.evidence.length}
                          </summary>
                          <Finding
                            finding={fit.finding}
                            showTurn={showTurn}
                            showRecording={showRecording}
                          />
                        </details>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>
            <section aria-labelledby="interview-evidence-heading">
              <h3
                tabIndex={-1}
                id="interview-evidence-heading"
                className="text-base font-semibold"
              >
                Interview Evidence
              </h3>
              <p className="mt-1 text-sm text-text-muted">
                {data.interview_profile?.name || "Interview plan"}
                {data.interview_profile
                  ? ` v${data.interview_profile.version}`
                  : ""}{" "}
                · Current finding per area
                {source ? " in the selected report snapshot" : ""}.
              </p>
              <div className="mt-3 divide-y divide-border">
                {areas.map((area) => (
                  <details key={area.topic_index} className="group py-3">
                    <summary className="cursor-pointer list-none rounded-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="font-medium">{area.topic}</span>
                        <RecruitmentState kind="coverage" value={area.state} />
                      </div>
                      <p className="mt-1 text-sm leading-relaxed text-text-secondary max-w-[75ch]">
                        {area.text}
                      </p>
                      {report?.body?.opening_requirements
                        ?.filter(
                          (r) =>
                            (area.topic === "Shift Flexibility" &&
                              ["weekend_required", "closing_shift"].includes(
                                r.key,
                              )) ||
                            (area.topic === "Availability / Start Date" &&
                              r.key === "preferred_start"),
                        )
                        .map((r) => (
                          <p
                            key={r.key}
                            className="mt-1 text-xs text-text-secondary"
                          >
                            {r.key === "weekend_required"
                              ? "Weekend requirement"
                              : r.key === "closing_shift"
                                ? "Closing shift requirement"
                                : "Preferred start"}
                            : {fitLabels[r.state]}
                          </p>
                        ))}
                      <span className="mt-2 inline-block text-xs text-text-muted">
                        {area.evidenceIds.length} supporting{" "}
                        {area.evidenceIds.length === 1 ? "turn" : "turns"} ·{" "}
                        <span className="group-open:hidden">View evidence</span>
                        <span className="hidden group-open:inline">
                          Hide evidence
                        </span>
                      </span>
                    </summary>
                    <div className="mt-3 space-y-3 text-sm">
                      {area.finding && (
                        <Finding
                          finding={area.finding}
                          showTurn={showTurn}
                          showRecording={showRecording}
                        />
                      )}
                      {area.evidenceIds.map((id) => {
                        const turn = turns.find((t) => t.id === id);
                        return (
                          <div
                            key={id}
                            className="rounded-lg bg-surface-muted p-3"
                          >
                            <p className="whitespace-pre-wrap">
                              {turn?.transcript}
                            </p>
                            <button
                              className="mt-2 text-primary underline"
                              onClick={() => showTurn(id)}
                            >
                              View transcript · Turn {turn?.turn_number}
                            </button>
                          </div>
                        );
                      })}
                      <details>
                        <summary className="cursor-pointer text-text-secondary">
                          Coverage evolution · {area.history.length} findings
                        </summary>
                        <ol className="mt-2 space-y-2">
                          {area.history.map((f) => (
                            <li
                              key={f.id}
                              className="border-b border-border py-2"
                            >
                              <span className="text-xs text-text-muted">
                                {coverageLabels[f.state]} ·{" "}
                                {new Date(f.created_at).toLocaleString()}
                              </span>
                              <p>{f.reason}</p>
                              <button
                                className="text-primary underline"
                                onClick={() => showTurn(f.evidence_turn_id)}
                              >
                                View cited transcript
                              </button>
                            </li>
                          ))}
                        </ol>
                      </details>
                    </div>
                  </details>
                ))}
              </div>
              {report?.status === "ready" &&
                report.body.scenarios.map((s) => (
                  <details
                    key={s.index}
                    className="border-t border-border py-3"
                  >
                    <summary className="cursor-pointer text-sm font-medium">
                      Scenario · {scenarios[s.index]}
                      <p className="mt-1 font-normal text-text-secondary">
                        {s.finding.text}
                      </p>
                    </summary>
                    <Finding
                      finding={s.finding}
                      showTurn={showTurn}
                      showRecording={showRecording}
                    />
                    {s.unresolved.map((f, i) => (
                      <Finding
                        key={i}
                        finding={f}
                        showTurn={showTurn}
                        showRecording={showRecording}
                      />
                    ))}
                  </details>
                ))}
            </section>
            <section id="review-followup" tabIndex={-1}>
              <h3 className="text-base font-semibold">
                Unresolved / Follow-up
              </h3>
              {report?.status === "ready" ? (
                report.body.follow_up.length ? (
                  report.body.follow_up.map((f, i) => (
                    <details
                      key={i}
                      className="border-b border-border py-3 text-sm"
                    >
                      <summary className="cursor-pointer">{f.text}</summary>
                      {f.evidence.length > 0 ? (
                        <Finding
                          finding={f}
                          showTurn={showTurn}
                          showRecording={showRecording}
                        />
                      ) : (
                        <p className="mt-2 text-text-muted">
                          Missing or uncertain information; no candidate
                          assertion is inferred.
                        </p>
                      )}
                    </details>
                  ))
                ) : (
                  <p className="mt-2 text-sm text-text-secondary">
                    No additional unresolved items identified in this report.
                  </p>
                )
              ) : (
                <p className="mt-2 text-sm text-text-secondary">
                  {areas
                    .filter((a) => a.state !== "covered")
                    .map((a) => a.topic)
                    .join(" · ") ||
                    "Awaiting report for consolidated follow-up."}
                </p>
              )}
            </section>
            <section className="border-t border-border pt-5">
              <h3
                id="review-original"
                tabIndex={-1}
                className="text-base font-semibold"
              >
                Original Evidence
              </h3>
              <p className="my-2 text-sm text-text-muted">
                AI-assisted findings require human verification. Appearance,
                accent, voice characteristics and inferred personality are not
                hiring signals.
              </p>
            </section>
            <details ref={transcriptSection}>
              <summary className="cursor-pointer font-semibold py-2">
                Transcript · {turns.length} turns
              </summary>
              <p className="text-sm text-text-muted">
                Provider text is relayed by the browser. Interrupted AI speech
                may include unplayed words. Recording links seek to approximate
                context, not exact word timing.
              </p>
              {turns.map((t, i) => (
                <div
                  key={t.id}
                  ref={(el) => {
                    turnRefs.current[t.id] = el;
                  }}
                  tabIndex={-1}
                  className={`border-b border-border py-3 ${focusTurn === t.id ? "rounded-lg bg-surface-muted px-3 ring-2 ring-primary" : ""}`}
                >
                  <p className="text-xs text-text-muted">
                    Turn {t.turn_number || i + 1} ·{" "}
                    {t.speaker === "candidate" ? "Candidate" : "AI interviewer"}{" "}
                    · ~{Math.round((t.elapsed_end_ms || 0) / 1000)}s
                    {data.annotations.some(
                      (a) =>
                        a.provider_generation === t.provider_generation &&
                        a.provider_item_id === t.provider_item_id &&
                        a.kind === "truncated",
                    )
                      ? " · AI interrupted"
                      : ""}
                  </p>
                  <p className="whitespace-pre-wrap">{t.transcript}</p>
                </div>
              ))}
            </details>
            <details ref={recordingSection}>
              <summary className="cursor-pointer font-semibold py-2">
                Recording · {data.units.length} units
              </summary>
              {data.units.map((u) => (
                <div
                  key={u.id}
                  className="my-3 rounded-xl border border-border p-3"
                >
                  <p>
                    Recording {u.sequence} · {u.status} ·{" "}
                    {Math.round(u.elapsed_start_ms / 1000)}s –{" "}
                    {u.elapsed_end_ms == null
                      ? "end unavailable"
                      : `${Math.round(u.elapsed_end_ms / 1000)}s`}
                    {u.end_reason && u.end_reason !== "completed"
                      ? ` · ${u.end_reason.replaceAll("_", " ")}`
                      : ""}
                  </p>
                  {u.signed_url ? (
                    <video
                      ref={(el) => {
                        videoRefs.current[u.id] = el;
                      }}
                      controls
                      playsInline
                      preload="none"
                      src={u.signed_url}
                      className="mt-2 w-full max-h-96"
                    />
                  ) : (
                    <p className="text-sm text-text-muted">
                      Recording unit unavailable. Acknowledged evidence is
                      retained privately.
                    </p>
                  )}
                </div>
              ))}
              {data.events
                .filter((e) =>
                  /gap|reconnect|disconnected|resumed/.test(e.action),
                )
                .map((e, i) => (
                  <p key={i} className="text-sm text-text-muted">
                    {new Date(e.occurred_at).toLocaleString()} ·{" "}
                    {e.action.replaceAll("_", " ")}
                    {e.details?.reason
                      ? ` · ${e.details.reason.replaceAll("_", " ")}`
                      : ""}
                  </p>
                ))}
            </details>
            <details>
              <summary className="cursor-pointer font-semibold py-2">
                Evidence / audit history
              </summary>
              <div className="space-y-2 py-2 text-sm text-text-secondary">
                {data.events.map((e, i) => (
                  <p key={i}>
                    {new Date(e.occurred_at).toLocaleString()} ·{" "}
                    {e.action.replaceAll("_", " ")}
                  </p>
                ))}
              </div>
            </details>
            <section
              id="review-decision"
              ref={decisionSection}
              tabIndex={-1}
              className="border-t border-border pt-5"
            >
              <h3 className="font-semibold">Manager Decision</h3>
              <p className="my-2 text-sm text-text-secondary">
                The manager owns this decision. AI reports cannot execute a
                hiring action.
              </p>
              {data.application.employee_id ? (
                <a
                  className="btn-primary inline-flex"
                  href={`/people/employees?employee=${data.application.employee_id}`}
                >
                  Continue Employee setup in People
                </a>
              ) : data.can_manage && !["hired", "rejected"].includes(state) ? (
                <>
                  <div className="flex flex-wrap gap-2">
                    {state === "review" && (
                      <button
                        className="btn-secondary"
                        disabled={busy}
                        onClick={() => setDecision("shortlisted")}
                      >
                        Shortlist
                      </button>
                    )}
                    {state === "shortlisted" && (
                      <button
                        className="btn-secondary"
                        disabled={busy}
                        onClick={() => setDecision("final_interview")}
                      >
                        Final Interview
                      </button>
                    )}
                    <button
                      className="btn-secondary"
                      disabled={busy}
                      onClick={() => setDecision("rejected")}
                    >
                      Reject
                    </button>
                    {["shortlisted", "final_interview"].includes(state) &&
                      data.can_hire && (
                        <button
                          className="btn-primary"
                          disabled={busy}
                          onClick={() => setDecision("hired")}
                        >
                          Hire
                        </button>
                      )}
                  </div>
                  {decision && (
                    <div className="mt-4 space-y-3 rounded-xl border border-border p-4">
                      <h4 className="font-semibold">
                        Confirm {decisionLabels[decision]}
                      </h4>
                      <AdminFormField label="Decision notes (optional)">
                        <textarea
                          className="control w-full"
                          maxLength={1000}
                          value={reason}
                          onChange={(e) => setReason(e.target.value)}
                        />
                      </AdminFormField>
                      {decision === "hired" && (
                        <>
                          <p className="text-sm">
                            Confirm Employee identity and start details.
                            Position, Workplace and Legal Employer come from
                            this opening. Login and Crew Access remain separate
                            People setup.
                          </p>
                          <div className="grid gap-3 md:grid-cols-2">
                            {[
                              ["full_name", "Full name"],
                              ["contact", "Contact number"],
                              ["nationality", "Nationality"],
                              ["ic_no", "IC / passport (optional)"],
                            ].map(([k, title]) => (
                              <AdminFormField key={k} label={title}>
                                <input
                                  className="control w-full"
                                  value={hire[k]}
                                  onChange={(e) => patchHire(k, e.target.value)}
                                />
                              </AdminFormField>
                            ))}
                            <AdminFormField label="Employment type">
                              <select
                                className="control w-full"
                                value={hire.employment_type}
                                onChange={(e) =>
                                  patchHire("employment_type", e.target.value)
                                }
                              >
                                {[
                                  "probation",
                                  "full_time",
                                  "part_time",
                                  "intern",
                                  "contract",
                                ].map((v) => (
                                  <option key={v} value={v}>
                                    {v.replaceAll("_", " ")}
                                  </option>
                                ))}
                              </select>
                            </AdminFormField>
                            <AdminFormField label="Joined date">
                              <DatePickerField
                                value={hire.joined_date}
                                onChange={(v) => patchHire("joined_date", v)}
                              />
                            </AdminFormField>
                            <AdminFormField label="Same-name clarification (only if prompted)">
                              <input
                                className="control w-full"
                                value={hire.duplicate_name_reason}
                                onChange={(e) =>
                                  patchHire(
                                    "duplicate_name_reason",
                                    e.target.value,
                                  )
                                }
                              />
                            </AdminFormField>
                          </div>
                        </>
                      )}
                      <div className="flex gap-2">
                        <button
                          className="btn-secondary"
                          disabled={busy}
                          onClick={() => setDecision("")}
                        >
                          Cancel
                        </button>
                        <button
                          className="btn-primary"
                          disabled={busy}
                          onClick={saveDecision}
                        >
                          {busy
                            ? "Saving…"
                            : decision === "hired"
                              ? "Confirm Hire and create Employee"
                              : "Save manager decision"}
                        </button>
                      </div>
                    </div>
                  )}
                </>
              ) : (
                <p>{decisionLabels[state]}</p>
              )}
              {data.decisions.map((d) => (
                <p key={d.request_id} className="mt-2 text-sm text-text-muted">
                  {new Date(d.occurred_at).toLocaleString()} ·{" "}
                  {decisionLabels[d.to_state]}
                  {d.reason ? ` · ${d.reason}` : ""}
                </p>
              ))}
            </section>
          </div>
        </div>
      )}
    </Modal>
  );
}
