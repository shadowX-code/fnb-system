import { useEffect, useRef, useState } from "react";
import Modal from "../../components/feedback/Modal.jsx";
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
            {e.recordings.map((r) => (
              <button
                key={r.unit_id}
                className="text-sm underline"
                onClick={() => showRecording(r)}
              >
                Recording {r.sequence} · ~{Math.round(r.offset_seconds)}s
              </button>
            ))}
            {!e.recordings.length && (
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
    topics =
      source?.config.required_topics || data?.topics.map((t) => t.topic) || [],
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
    setFocusTurn(id);
    turnRefs.current[id]?.scrollIntoView({
      behavior: "smooth",
      block: "center",
    });
  }
  function showRecording(ref) {
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
  const patchHire = (k, v) => setHire((h) => ({ ...h, [k]: v }));
  return (
    <Modal
      title={`${application.name} · Application review`}
      size="xl"
      onClose={onClose}
      footer={
        <button
          className="btn-secondary"
          disabled={busy}
          onClick={() => act(async () => {})}
        >
          Refresh evidence and playback
        </button>
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
        <div className="space-y-6">
          <header className="space-y-2">
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
            <p>
              Interview:{" "}
              <strong>{data.attempt?.status || "Not started"}</strong> ·{" "}
              {decisionLabels[state]}
            </p>
            <p>
              Recording {data.attempt?.recording_state || "not started"}
              {data.events.filter((e) => e.action === "recording_gap").length
                ? ` · ${data.events.filter((e) => e.action === "recording_gap").length} disclosed gaps`
                : ""}{" "}
              · Transcript{" "}
              {data.annotations.some((a) => a.kind === "transcription_failed")
                ? "has disclosed gaps"
                : data.turns.some((t) => t.speaker === "candidate")
                  ? "available · provider relay"
                  : "unavailable"}
            </p>
            <p className="text-sm text-text-secondary">
              Partial evidence describes collection quality, not candidate
              performance. Recordings support human verification; appearance,
              expressions, accent, voice characteristics and inferred
              personality are not hiring signals.
            </p>
          </header>
          {!data.launch_ready && (
            <p
              role="status"
              className="rounded-lg bg-surface-muted p-3 text-sm"
            >
              Not ready for real candidate collection: approved consent copy is
              still required. Synthetic QA only.
            </p>
          )}
          <section>
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
                    {report.body.candidate_snapshot.length ? (
                      report.body.candidate_snapshot.map((f, i) => (
                        <Finding
                          key={i}
                          finding={f}
                          showTurn={showTurn}
                          showRecording={showRecording}
                        />
                      ))
                    ) : (
                      <p>No factual candidate snapshot established.</p>
                    )}
                    <h4 className="mt-5 font-semibold">Required Topics</h4>
                    {report.body.topics.map((t) => (
                      <div
                        key={t.index}
                        className="border-b border-border py-2"
                      >
                        <p className="font-medium">
                          {topics[t.index]} · {t.state}
                        </p>
                        <Finding
                          finding={t.finding}
                          showTurn={showTurn}
                          showRecording={showRecording}
                        />
                      </div>
                    ))}
                    <h4 className="mt-5 font-semibold">Scenario Evidence</h4>
                    {report.body.scenarios.map((s) => (
                      <div
                        key={s.index}
                        className="border-b border-border py-2"
                      >
                        <p className="font-medium">{scenarios[s.index]}</p>
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
                      </div>
                    ))}
                    <h4 className="mt-5 font-semibold">
                      Unresolved / Manager Follow-up
                    </h4>
                    {report.body.follow_up.map((f, i) => (
                      <Finding
                        key={i}
                        finding={f}
                        showTurn={showTurn}
                        showRecording={showRecording}
                      />
                    ))}
                    <p className="mt-3 text-sm text-text-muted">
                      Report evidence: {report.body.limitations.recording_state}{" "}
                      recording · {report.body.limitations.gaps} gaps ·{" "}
                      {report.body.limitations.annotations} transcript
                      annotations. Findings are AI-assisted and require human
                      verification.
                    </p>
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
                {report && data.can_manage && (
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
          {data.coverage_findings?.length > 0 && (
            <section>
              <h3 className="font-semibold">Evidence collection</h3>
              <p className="text-sm text-text-muted">
                {data.interview_profile?.name} v
                {data.interview_profile?.version} · Collection progress, not a
                candidate score.
              </p>
              <div className="mt-2 divide-y divide-border">
                {data.coverage_findings.map((f) => (
                  <div key={f.id} className="py-2 text-sm">
                    <p className="font-medium">
                      {
                        data.topics.find((t) => t.topic_index === f.topic_index)
                          ?.topic
                      }{" "}
                      · {f.state}
                    </p>
                    <p>{f.reason}</p>
                    <button
                      type="button"
                      className="text-primary underline"
                      onClick={() => showTurn(f.evidence_turn_id)}
                    >
                      View cited transcript
                    </button>
                  </div>
                ))}
              </div>
            </section>
          )}
          <section>
            <h3 className="font-semibold">Transcript</h3>
            <p className="text-sm text-text-muted">
              Provider text is relayed by the browser. Interrupted AI speech may
              include unplayed words. Recording links seek to approximate
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
                  {t.speaker === "candidate" ? "Candidate" : "AI interviewer"} ·
                  ~{Math.round((t.elapsed_end_ms || 0) / 1000)}s
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
          </section>
          <section>
            <h3 className="font-semibold">Recording</h3>
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
                    preload="metadata"
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
          </section>
          <section className="border-t border-border pt-5">
            <h3 className="font-semibold">Manager Decision</h3>
            <p className="my-2 text-sm text-text-secondary">
              The manager owns this decision. AI reports cannot execute a hiring
              action.
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
                          Confirm Employee identity and start details. Position,
                          Workplace and Legal Employer come from this opening.
                          Login and Crew Access remain separate People setup.
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
      )}
    </Modal>
  );
}
