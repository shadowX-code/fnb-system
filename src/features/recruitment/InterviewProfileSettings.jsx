import { useState } from "react";
import PageHeader from "../../components/layout/PageHeader.jsx";
import AdminFormField from "../../components/forms/AdminFormField.jsx";
import {
  RecruitmentSection,
  RecruitmentState,
  RecruitmentEmpty,
} from "./RecruitmentPresentation.jsx";

export default function InterviewProfileSettings({
  profiles,
  busy,
  onPublish,
  onClose,
  canManage = false,
}) {
  const [versionId, setVersionId] = useState(null),
    [editing, setEditing] = useState(false),
    [draft, setDraft] = useState(null),
    [error, setError] = useState("");
  const selected = profiles.find((p) => p.id === versionId);
  const families = [...new Set(profiles.map((p) => p.name))].map((name) =>
    profiles
      .filter((p) => p.name === name)
      .sort((a, b) => b.version - a.version),
  );
  const latest = selected
    ? families.find((f) => f[0].name === selected.name)[0]
    : profiles[0];
  const patch = (key, value) => setDraft((d) => ({ ...d, [key]: value }));
  async function publish() {
    setError("");
    try {
      await onPublish(draft, latest.version);
      setEditing(false);
      setVersionId(null);
    } catch (e) {
      setError(e.message);
    }
  }
  return (
    <>
      <button
        className="text-sm text-text-secondary justify-self-start"
        onClick={onClose}
      >
        ← Recruitment
      </button>
      <PageHeader
        title={selected ? selected.name : "Interview Profiles"}
        description={
          selected
            ? "Evidence, conversational guidance and completion criteria."
            : "A library of reusable interview plans. Published versions remain fixed."
        }
        primaryActions={
          selected && canManage ? (
            editing ? (
              <div className="flex gap-2">
                <button
                  className="btn-secondary"
                  onClick={() => setEditing(false)}
                >
                  Discard draft
                </button>
                <button
                  className="btn-primary"
                  disabled={busy}
                  onClick={publish}
                >
                  Publish {latest.name} v{latest.version + 1}
                </button>
              </div>
            ) : (
              <button
                className="btn-primary"
                onClick={() => {
                  setDraft(structuredClone(latest.definition));
                  setEditing(true);
                }}
              >
                Prepare next version
              </button>
            )
          ) : null
        }
      />
      {error && (
        <p role="alert" className="text-red-700">
          {error}
        </p>
      )}
      {!selected ? (
        <RecruitmentSection title="Profile library" className="is-list">
          {families.map((versions) => {
            const p = versions[0];
            return (
              <div className="recruitment-profile-row" key={p.name}>
                <div>
                  <div className="flex items-center gap-2">
                    <strong className="text-sm">{p.name}</strong>
                    <RecruitmentState value={p.status || "published"} />
                  </div>
                  <p>
                    Version {p.version} · {versions.length} published{" "}
                    {versions.length === 1 ? "version" : "versions"}
                  </p>
                </div>
                <div className="text-xs text-text-secondary">
                  <p>
                    {p.definition.evidence_areas.length} evidence areas ·{" "}
                    {p.definition.scenarios.length}{" "}
                    {p.definition.scenarios.length === 1
                      ? "scenario"
                      : "scenarios"}
                  </p>
                  <p>
                    Target {p.definition.target_minutes} min · Maximum{" "}
                    {p.definition.max_minutes} min
                  </p>
                </div>
                <button
                  className="btn-secondary"
                  onClick={() => setVersionId(p.id)}
                >
                  View profile
                </button>
              </div>
            );
          })}
          {!families.length && (
            <RecruitmentEmpty>
              No interview profiles are available.
            </RecruitmentEmpty>
          )}
        </RecruitmentSection>
      ) : (
        <>
          <div className="flex items-center justify-between gap-3">
            <button
              className="btn-ghost"
              onClick={() => {
                setVersionId(null);
                setEditing(false);
              }}
            >
              ← Profile library
            </button>
            <div className="flex gap-2">
              <RecruitmentState value={editing ? "draft" : "published"} />
              <span className="text-sm text-text-secondary">
                Version {editing ? latest.version + 1 : selected.version}
              </span>
            </div>
          </div>
          {editing ? (
            <div className="space-y-4">
              <AdminFormField label="Role context">
                <textarea
                  className="control w-full"
                  value={draft.role_context}
                  onChange={(e) => patch("role_context", e.target.value)}
                />
              </AdminFormField>
              {draft.evidence_areas.map((area, index) => (
                <div
                  key={index}
                  className="grid gap-3 border-t border-border pt-3 md:grid-cols-3"
                >
                  <AdminFormField label="Evidence area">
                    <input
                      className="control w-full"
                      value={area.name}
                      onChange={(e) =>
                        patch(
                          "evidence_areas",
                          draft.evidence_areas.map((a, i) =>
                            i === index ? { ...a, name: e.target.value } : a,
                          ),
                        )
                      }
                    />
                  </AdminFormField>
                  <AdminFormField label="Priority">
                    <select
                      className="control w-full"
                      value={area.priority}
                      onChange={(e) =>
                        patch(
                          "evidence_areas",
                          draft.evidence_areas.map((a, i) =>
                            i === index
                              ? { ...a, priority: e.target.value }
                              : a,
                          ),
                        )
                      }
                    >
                      {["Core", "Important", "Optional"].map((p) => (
                        <option key={p}>{p}</option>
                      ))}
                    </select>
                  </AdminFormField>
                  <AdminFormField label="Evidence intent">
                    <textarea
                      className="control w-full"
                      value={area.intent}
                      onChange={(e) =>
                        patch(
                          "evidence_areas",
                          draft.evidence_areas.map((a, i) =>
                            i === index ? { ...a, intent: e.target.value } : a,
                          ),
                        )
                      }
                    />
                  </AdminFormField>
                </div>
              ))}
              <AdminFormField label="Follow-up guidance">
                <textarea
                  className="control min-h-28 w-full"
                  value={draft.follow_up_guidance}
                  onChange={(e) => patch("follow_up_guidance", e.target.value)}
                />
              </AdminFormField>
              <AdminFormField label="Scenarios" helper="One brief per line.">
                <textarea
                  className="control w-full"
                  value={draft.scenarios.join("\n")}
                  onChange={(e) =>
                    patch(
                      "scenarios",
                      e.target.value.split("\n").filter((s) => s.trim()),
                    )
                  }
                />
              </AdminFormField>
              <div className="grid gap-3 sm:grid-cols-2">
                {["target_minutes", "max_minutes"].map((key) => (
                  <AdminFormField
                    key={key}
                    label={
                      key === "target_minutes"
                        ? "Target minutes"
                        : "Maximum minutes"
                    }
                  >
                    <input
                      className="control w-full"
                      type="number"
                      min="5"
                      max="120"
                      value={draft[key]}
                      onChange={(e) => patch(key, Number(e.target.value))}
                    />
                  </AdminFormField>
                ))}
                {["Important", "Optional"].map((priority) => (
                  <AdminFormField
                    key={priority}
                    label={`${priority} completion minimum`}
                  >
                    <select
                      className="control w-full"
                      value={draft.completion_criteria[priority]}
                      onChange={(e) =>
                        patch("completion_criteria", {
                          ...draft.completion_criteria,
                          [priority]: e.target.value,
                        })
                      }
                    >
                      {(priority === "Important"
                        ? ["partial", "covered"]
                        : ["unresolved", "partial", "covered"]
                      ).map((v) => (
                        <option key={v} value={v}>
                          {v}
                        </option>
                      ))}
                    </select>
                  </AdminFormField>
                ))}
              </div>
              <p className="text-sm text-text-muted">
                Core evidence must be Covered and scenarios answered.
                Publication creates a new version; existing openings are not
                changed.
              </p>
            </div>
          ) : (
            <div className="recruitment-profile-layout">
              <div className="grid gap-5">
                <RecruitmentSection
                  title="Evidence areas"
                  description="Priorities define the evidence needed before an interview can conclude."
                >
                  {selected.definition.evidence_areas.map((area) => (
                    <div
                      key={area.name}
                      className="py-3 border-b border-border last:border-0"
                    >
                      <div className="flex justify-between gap-3">
                        <h3 className="font-semibold text-sm">{area.name}</h3>
                        <RecruitmentState value={area.priority} />
                      </div>
                      <p className="text-sm text-text-secondary mt-1">
                        {area.intent}
                      </p>
                    </div>
                  ))}
                </RecruitmentSection>
                <RecruitmentSection title="Scenarios">
                  {selected.definition.scenarios.map((brief, i) => (
                    <p className="text-sm py-2" key={i}>
                      {brief}
                    </p>
                  ))}
                </RecruitmentSection>
                <RecruitmentSection title="Conversational guidance">
                  <p className="text-sm text-text-secondary">
                    {selected.definition.follow_up_guidance}
                  </p>
                </RecruitmentSection>
              </div>
              <aside className="grid gap-5">
                <RecruitmentSection title="Interview plan">
                  <p className="text-sm">{selected.definition.role_context}</p>
                  <p className="text-xs text-text-secondary mt-4">
                    Target {selected.definition.target_minutes} min · Maximum{" "}
                    {selected.definition.max_minutes} min
                  </p>
                </RecruitmentSection>
                <RecruitmentSection title="Completion criteria">
                  <dl className="recruitment-facts">
                    {Object.entries(
                      selected.definition.completion_criteria,
                    ).map(([key, value]) => (
                      <div key={key} className="contents">
                        <dt className="capitalize">{key}</dt>
                        <dd className="capitalize">{value}</dd>
                      </div>
                    ))}
                  </dl>
                </RecruitmentSection>
                <RecruitmentSection
                  title="Version history"
                  description="Existing invitations keep their selected version."
                >
                  {profiles
                    .filter((p) => p.name === selected.name)
                    .map((p) => (
                      <button
                        className="recruitment-attention-row"
                        key={p.id}
                        onClick={() => setVersionId(p.id)}
                        aria-current={p.id === versionId ? "true" : undefined}
                      >
                        <span>
                          Version {p.version}
                          {p.id === latest.id ? " · Latest" : ""}
                        </span>
                        <RecruitmentState value={p.status || "published"} />
                      </button>
                    ))}
                </RecruitmentSection>
              </aside>
            </div>
          )}
        </>
      )}
    </>
  );
}
