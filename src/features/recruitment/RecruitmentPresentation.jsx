import { useEffect, useState } from "react";
import Badge from "../../components/ui/Badge.jsx";
import { recruitmentService } from "./recruitmentService.js";
import { fitLabels, coverageLabels } from "./reviewIntelligence.js";
import "./recruitmentWorkspace.css";

export function RecruitmentState({ value, kind = "lifecycle", children }) {
  const text =
    children ||
    (kind === "fit"
      ? fitLabels[value]
      : kind === "coverage"
        ? coverageLabels[value]
        : value?.replaceAll("_", " ")) ||
    "Not available";
  const tone =
    kind === "coverage"
      ? value === "covered"
        ? "info"
        : value === "partial"
          ? "warning"
          : "neutral"
      : kind === "fit"
        ? value === "meets"
          ? "success"
          : value === "does_not_meet"
            ? "danger"
            : "neutral"
        : ["open", "published", "completed", "complete", "hired"].includes(
              value,
            )
          ? "success"
          : ["needs_review", "partial", "interrupted", "finalizing"].includes(
                value,
              )
            ? "warning"
            : ["failed", "invalid", "rejected"].includes(value)
              ? "danger"
              : "neutral";
  return (
    <Badge tone={tone}>
      {kind === "lifecycle" && typeof text === "string"
        ? text[0]?.toUpperCase() + text.slice(1)
        : text}
    </Badge>
  );
}
export function RecruitmentMetrics({ items }) {
  return (
    <dl className="recruitment-metrics">
      {items.map(({ key, label, value, attention }) => (
        <div
          key={key || label}
          className={attention && value > 0 ? "is-attention" : ""}
        >
          <dt>{label}</dt>
          <dd>{value ?? 0}</dd>
        </div>
      ))}
    </dl>
  );
}
export function RecruitmentSection({
  title,
  description,
  action,
  children,
  className = "",
}) {
  return (
    <section className={`recruitment-section ${className}`}>
      <header>
        <div>
          <h2>{title}</h2>
          {description && <p>{description}</p>}
        </div>
        {action}
      </header>
      <div className="recruitment-section-body">{children}</div>
    </section>
  );
}
export function RecruitmentEmpty({ children }) {
  return <p className="recruitment-empty">{children}</p>;
}
export function OpeningPlan({ opening, profile }) {
  const config = opening.config,
    requirements = config.opening_requirements || {};
  return (
    <div className="recruitment-plan">
      <div className="flex flex-wrap items-center gap-2">
        <strong>
          {profile
            ? `${profile.name} v${profile.version}`
            : "Opening interview plan"}
        </strong>
        <span className="text-xs text-text-secondary">
          Target {config.target_minutes} min · Maximum {config.max_minutes} min
        </span>
      </div>
      <ul className="recruitment-requirements">
        {requirements.weekend_required && (
          <li>Weekend availability required</li>
        )}
        {requirements.closing_shift && <li>{requirements.closing_shift}</li>}
        {requirements.preferred_start && (
          <li>{requirements.preferred_start}</li>
        )}
      </ul>
      <details>
        <summary>Evidence areas & scenarios</summary>
        <div className="recruitment-plan-areas">
          {(
            profile?.definition.evidence_areas ||
            config.required_topics.map((name) => ({
              name,
              priority: "Required",
            }))
          ).map((area) => (
            <div key={area.name}>
              <span>{area.name}</span>
              <Badge>{area.priority}</Badge>
            </div>
          ))}
        </div>
        {config.scenario_briefs.map((brief, i) => (
          <p key={i} className="mt-3 text-sm text-text-secondary">
            Scenario: {brief}
          </p>
        ))}
      </details>
      <p className="text-xs text-text-secondary">
        The selected version stays fixed for each invitation. Updating setup
        affects new invitations.
      </p>
    </div>
  );
}
// Existing protected evidence read supplies finalized report fit; no fit is inferred
// from coverage, and no new report generation happens on candidate list reads.
export function CandidateFitSummary({ application, revision }) {
  const [report, setReport] = useState(null),
    [state, setState] = useState("loading");
  useEffect(() => {
    let active = true;
    setReport(null);
    setState("loading");
    if (
      !["completed", "partial", "failed"].includes(application.attempt_status)
    ) {
      setState("none");
      return;
    }
    recruitmentService
      .managerEvidence(application.id)
      .then((data) => {
        if (active) {
          setReport(
            data.reports?.[0]?.status === "ready" ? data.reports[0] : null,
          );
          setState("loaded");
        }
      })
      .catch(() => {
        if (active) setState("error");
      });
    return () => {
      active = false;
    };
  }, [application.id, application.attempt_status, revision]);
  if (state === "none")
    return (
      <span className="text-xs text-text-secondary">
        Fit after interview review
      </span>
    );
  const fits = report?.body?.opening_requirements || [];
  if (!fits.length)
    return (
      <span className="text-xs text-text-secondary">
        {state === "loading"
          ? "Loading requirement evidence…"
          : state === "error"
            ? "Fit available in review"
            : report
              ? "Requirement fit not included in this report"
              : "Requirement fit awaiting report"}
      </span>
    );
  return (
    <div className="flex flex-wrap gap-1.5">
      {["meets", "does_not_meet", "unclear"].map((value) => {
        const count = fits.filter((f) => f.state === value).length;
        return count > 0 ? (
          <RecruitmentState key={value} kind="fit" value={value}>
            {count} {fitLabels[value]}
          </RecruitmentState>
        ) : null;
      })}
    </div>
  );
}
