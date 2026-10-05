import InterviewIntelligenceBuilder from "./InterviewIntelligenceBuilder.jsx";
import { profileDraft } from "./serviceCrewV2.js";
import { useState } from "react";
import PageHeader from "../../components/layout/PageHeader.jsx";
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
                className="btn-secondary"
                onClick={() => {
                  setDraft(profileDraft(latest.definition));
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
          <InterviewIntelligenceBuilder
            definition={editing ? draft : selected.definition}
            onChange={editing ? setDraft : undefined}
            version={editing ? latest.version + 1 : selected.version}
          />
          {!editing && (
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
                    <RecruitmentState value="published" />
                  </button>
                ))}
            </RecruitmentSection>
          )}
        </>
      )}
    </>
  );
}
