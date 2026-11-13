import InterviewIntelligenceBuilder from "./InterviewIntelligenceBuilder.jsx";
import { profileDraft } from "./serviceCrewV2.js";
import { useEffect, useRef, useState } from "react";
import { recruitmentService } from "./recruitmentService.js";
import PageHeader from "../../components/layout/PageHeader.jsx";
import DataTable from "../../components/tables/DataTable.jsx";
import AdminFormField from "../../components/forms/AdminFormField.jsx";
import SelectField from "../../components/forms/SelectField.jsx";
import AdminSegmentedControl from "../../components/forms/AdminSegmentedControl.jsx";
import Modal from "../../components/feedback/Modal.jsx";
import { profilePublishIssues } from "./interviewProfileChecks.js";
import { formatRecruitmentTime, interviewStateLabel } from "./candidateOperations.js";
import RecruitmentEvidenceReview from "./RecruitmentEvidenceReview.jsx";
import {
  RecruitmentSection,
  RecruitmentState,
  RecruitmentEmpty,
} from "./RecruitmentPresentation.jsx";

const builderSteps = [
  {value:"template",label:"Template"},
  {value:"role",label:"Role & Knowledge"},
  {value:"assessment",label:"Assessment Plan"},
  {value:"behavior",label:"Interview Behavior"},
  {value:"preview",label:"Preview & Publish"},
];

export default function InterviewProfileSettings({
  profiles,
  positions = [],
  openings = [],
  onJobFacts,
  busy,
  onPublish,
  onClose,
  canManage = false,
  resumeDraftId,
  resumeJobId,
}) {
  const [versionId, setVersionId] = useState(null),
    [editing, setEditing] = useState(false),
    [draft, setDraft] = useState(null),
    [saved, setSaved] = useState(null),
    [drafts, setDrafts] = useState([]),
    [loading, setLoading] = useState(true),
    [pending, setPending] = useState(false),
    [error, setError] = useState(""),
    [conflict, setConflict] = useState(false),
    [step, setStep] = useState("role"),
    [creation, setCreation] = useState(null),
    [templates, setTemplates] = useState([]),
    [testJobId, setTestJobId] = useState(""),
    [testLink, setTestLink] = useState(null),
    [testHistory, setTestHistory] = useState(null),
    [testReview, setTestReview] = useState(null),
    [publishedId, setPublishedId] = useState(null);
  const operation = useRef(false);
  const creationRequest = useRef(null);
  useEffect(() => {
    const controller = new AbortController();
    recruitmentService
      .profileDrafts(controller.signal)
      .then((rows) => {
        if (!controller.signal.aborted) {
          setDrafts(rows);
          if (resumeDraftId && rows.some(p => p.id === resumeDraftId)) {
            view(resumeDraftId,rows);
            setTestJobId(resumeJobId || "");
          }
        }
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [resumeDraftId, resumeJobId]);
  const selected =
    profiles.find((p) => p.id === versionId) ||
    drafts.find((p) => p.id === versionId);
  const families = [...new Set(profiles.map((p) => p.profile_key || p.name))].map((key) =>
    profiles
      .filter((p) => (p.profile_key || p.name) === key)
      .sort((a, b) => b.version - a.version),
  );
  const versions = selected
    ? families.find((f) => (f[0].profile_key || f[0].name) === (selected.profile_key || selected.name)) || []
    : [];
  const latest = versions[0];
  const isDraft = selected?.status === "draft";
  const dirty =
    editing &&
    JSON.stringify(draft) !== JSON.stringify(profileDraft(saved?.definition));
  const locked = busy || pending || loading;
  const position = positions?.find(p => p.id === selected?.position_id);
  const eligibleJobs = openings.filter(job => job.status !== "closed" &&
    (!selected?.position_id || selected.position_id === job.position_id));
  const testJob = eligibleJobs.find(job => job.id === testJobId);
  const issues = editing && draft ? profilePublishIssues(draft) : [];
  const jobFacts = testJob?.config?.job_facts || {};
  const pendingFacts = testJob?.config?.unverified_job_facts || {};
  function library() {
    setVersionId(null);
    setEditing(false);
    setError("");
    setConflict(false);
    setTestLink(null);
    setTestHistory(null);
    setPublishedId(null);
  }
  function view(id, rows = drafts) {
    const record = rows.find((p) => p.id === id);
    setVersionId(id);
    setEditing(Boolean(record && canManage));
    setSaved(record || null);
    setDraft(record ? profileDraft(record.definition) : null);
    setError("");
    setConflict(false);
    setStep("role");
    setTestJobId("");
    setTestLink(null);
    setTestHistory(null);
    setPublishedId(null);
  }
  async function run(action) {
    if (operation.current) return;
    operation.current = true;
    setPending(true);
    setError("");
    try {
      await action();
    } catch (e) {
      setError(e.message);
      setConflict(["PT409", "40001"].includes(e.cause?.code));
    } finally {
      operation.current = false;
      setPending(false);
    }
  }
  function remember(record) {
    setDrafts((rows) => [record, ...rows.filter((r) => r.id !== record.id)]);
    setSaved(record);
    setDraft(profileDraft(record.definition));
    setVersionId(record.id);
    setEditing(true);
    setConflict(false);
  }
  function prepare() {
    return run(async () =>
      remember(
        await recruitmentService.prepareProfileDraft(
          latest.profile_key,
          latest.version,
        ),
      ),
    );
  }
  function startCreation(source) {
    creationRequest.current = null;
    setCreation({name:source ? `${source.name} copy` : "",positionId:source?.position_id || "",templateKey:"",sourceId:source?.id});
    setError("");
    if (!source) run(async () => {
      const rows = await recruitmentService.profileTemplates();
      setTemplates(rows);
      if (rows.length === 1) setCreation(current => current && {...current,templateKey:current.templateKey || rows[0].key});
    });
  }
  function create() {
    const payload = JSON.stringify(creation);
    if (creationRequest.current?.payload !== payload) creationRequest.current = {payload,id:crypto.randomUUID()};
    return run(async () => {
      const record = await recruitmentService.createProfileDraft({...creation,requestId:creationRequest.current.id});
      setCreation(null);
      setStep("role");
      setTestJobId("");
      setTestLink(null);
      remember(record);
    });
  }
  function save() {
    return run(async () =>
      remember(
        await recruitmentService.saveProfileDraft(
          saved.id,
          saved.revision,
          draft,
        ),
      ),
    );
  }
  function reload() {
    return run(async () => {
      const rows = await recruitmentService.profileDrafts();
      setDrafts(rows);
      if (versionId && rows.some((p) => p.id === versionId))
        view(versionId, rows);
      else library();
    });
  }
  function publish() {
    return run(async () => {
      const id = await onPublish(saved.id, saved.revision);
      setDrafts(await recruitmentService.profileDrafts());
      view(id, []);
      setPublishedId(id);
    });
  }
  function startTest() {
    return run(async () => {
      const test = await recruitmentService.testProfileDraft(saved.id,saved.revision,testJob.id,testJob.config_version);
      const host = import.meta.env.VITE_INTERVIEW_WEB_APP_HOSTNAME;
      setTestLink({...test,revision:saved.revision,url:`${host ? `https://${host}` : window.location.origin}/i/${test.token}`});
      setTestHistory(null);
    });
  }
  function loadTestHistory() {
    return run(async () => setTestHistory(await recruitmentService.profileTestHistory(selected.profile_key)));
  }
  function revokeTest(test) {
    return run(async () => {
      await recruitmentService.revokeInvitation(test.application_id);
      if (testLink?.application_id === test.application_id) setTestLink(null);
      setTestHistory(await recruitmentService.profileTestHistory(selected.profile_key));
    });
  }
  const current = editing ? draft : selected?.definition;
  return (
    <>
      <PageHeader
        wrapTitle
        breadcrumbs={[
          { label: "Recruitment", onClick: onClose },
          selected
            ? { label: "Interview Profiles", onClick: library }
            : { label: "Interview Profiles" },
          ...(selected ? [{ label: selected.name }] : []),
        ]}
        title={selected ? selected.name : "Interview Profiles"}
        description={
          selected
            ? "A reusable evidence plan for this role."
            : "Reusable interview plans with fixed published versions."
        }
        metadata={
          selected ? (
            <>
              <RecruitmentState
                value={isDraft ? "draft" : selected.status || "published"}
              />
              <span>
                Version {selected.version}
                {!isDraft && selected.id === latest?.id ? " · Latest" : ""}
                {isDraft
                  ? ` · ${dirty ? "Unsaved changes" : "Saved draft"}`
                  : ""}
              </span>
              {position && <span>{position.name}</span>}
              <span>
                Target {current.target_minutes} min · Maximum{" "}
                {current.max_minutes} min
              </span>
            </>
          ) : null
        }
        primaryActions={
          !selected && canManage ? (
            <button className="btn-primary" disabled={locked} onClick={() => startCreation()}>Create profile</button>
          ) : selected && canManage ? (
            editing ? (
              <>
                {latest && <button
                  className="btn-secondary"
                  disabled={locked}
                  onClick={() => view(latest.id)}
                >
                  View published version
                </button>}
                <button
                  className="btn-primary"
                  disabled={locked || !dirty || conflict}
                  onClick={save}
                >
                  Save Draft
                </button>
              </>
            ) : (
              <>
              {!isDraft && <button className="btn-secondary" disabled={locked} onClick={() => startCreation(selected)}>Duplicate</button>}
              <button
                className="btn-secondary"
                disabled={locked}
                onClick={prepare}
              >
                {drafts.some((p) => p.profile_key === selected.profile_key)
                  ? "Resume draft"
                  : "Prepare next version"}
              </button>
              </>
            )
          ) : null
        }
      />
      {publishedId && selected?.id === publishedId && (
        <p className="text-sm text-text-secondary" role="status">{selected.name} v{selected.version} is available for new job configurations.</p>
      )}
      {error && !creation && (
        <div role="alert" className="text-red-700">
          {error}
          <button className="btn-secondary" disabled={pending} onClick={reload}>
            {conflict
              ? "Discard local edits and reload saved draft"
              : "Reload drafts"}
          </button>
        </div>
      )}
      {loading && <p role="status">Loading saved drafts…</p>}
      {editing && (
        <p className="text-sm text-text-secondary" role="status">
          {dirty
            ? "Unsaved changes. Save Draft before leaving or publishing."
            : "Draft saved. You can return later to continue editing. Publication is a separate action."}
        </p>
      )}
      {!selected ? (
        <RecruitmentSection
          title="Profile library"
          className="is-list"
          description={`${families.length} reusable ${families.length === 1 ? "plan" : "plans"}`}
        >
          <DataTable
            density="compact"
            minWidth={700}
            rows={[...drafts, ...families.map((f) => f[0])]}
            getRowKey={(p) => p.id}
            tableClassName="recruitment-profile-table"
            onRowClick={(p) => view(p.id)}
            columns={[
              {
                key: "name",
                header: "Interview profile",
                render: (p) => (
                  <div>
                    <strong className="text-sm">{p.name}</strong>
                    {positions.find(position => position.id === p.position_id)?.name && (
                      <p className="recruitment-row-meta">{positions.find(position => position.id === p.position_id).name}</p>
                    )}
                    <p className="recruitment-row-meta">
                      {p.definition.role_context ||
                        "Reusable role evidence plan"}
                    </p>
                  </div>
                ),
              },
              {
                key: "version",
                header: "Version",
                render: (p) => (
                  <div className="recruitment-cell-stack">
                    <RecruitmentState value={p.status || "published"} />
                    <span>
                      Version {p.version}
                      {p.status === "draft"
                        ? " · Saved draft"
                        : " · Latest published"}
                    </span>
                  </div>
                ),
              },
              {
                key: "evidence",
                header: "Assessment plan",
                render: (p) => (
                  <div className="recruitment-cell-stack">
                    <span>
                      {(p.definition.evidence_areas || []).length} assessment
                      areas
                    </span>
                    <span>
                      {(p.definition.scenarios || []).length}{" "}
                      {(p.definition.scenarios || []).length === 1
                        ? "scenario"
                        : "scenarios"}
                    </span>
                  </div>
                ),
              },
              {
                key: "duration",
                header: "Duration",
                render: (p) => (
                  <div className="recruitment-cell-stack">
                    <span>Target {p.definition.target_minutes} min</span>
                    <span className="text-text-secondary">
                      Maximum {p.definition.max_minutes} min
                    </span>
                  </div>
                ),
              },
              {
                key: "action",
                header: "Action",
                render: (p) => (
                  <button
                    className="btn-secondary"
                    aria-label={`${p.status === "draft" && canManage ? "Resume" : "View"} ${p.name}${p.status === "draft" ? " draft" : " profile"}`}
                    onClick={() => view(p.id)}
                  >
                    {p.status === "draft" && canManage
                      ? "Resume draft"
                      : "View"}
                  </button>
                ),
              },
            ]}
          />
          {!families.length && !drafts.length && !loading && (
            <RecruitmentEmpty>
              No interview profiles are available.
            </RecruitmentEmpty>
          )}
        </RecruitmentSection>
      ) : (
        <>
          {editing && (
            <AdminSegmentedControl label="Builder steps" value={step} onChange={setStep}
              options={builderSteps.map(s => ({ ...s,panelId:"profile-builder-step",disabled:pending }))} />
          )}
          <fieldset disabled={locked || conflict} className="min-w-0"
            id={editing ? "profile-builder-step" : undefined}
            aria-label={editing ? builderSteps.find(s => s.value === step)?.label : undefined}>
            {editing && step === "template" && (
              <RecruitmentSection title="Starting plan">
                <p className="text-sm text-text-secondary">
                  {saved.template_name || (saved.source_profile_id ? "Duplicated published profile" : "Previous published version")}
                </p>
                {position && <p className="mt-1 text-sm font-medium">{position.name}</p>}
              </RecruitmentSection>
            )}
            {(!editing || ["role","assessment","behavior"].includes(step)) && (
              <InterviewIntelligenceBuilder definition={current} onChange={editing ? setDraft : undefined}
                version={selected.version} unpublished={isDraft} step={editing ? step : undefined} />
            )}
            {editing && ["role","preview"].includes(step) && (
              <RecruitmentSection title="Job Facts" className="mt-3">
                <div className="grid gap-3">
                  <p className="text-sm text-text-secondary">Choose a job to preview the hiring terms the interviewer can share.</p>
                  <AdminFormField label="Hiring context">
                    <SelectField ariaLabel="Hiring context" value={testJobId}
                      options={eligibleJobs.map(job => ({value:job.id,label:job.title,description:`${job.workplace} · ${job.employer_name}`}))}
                      placeholder="Select a job" onChange={id => {setTestJobId(id);setTestLink(null);}} />
                  </AdminFormField>
                  {testJob && (
                    <div className="text-sm">
                      <p>{Object.keys(jobFacts).length} verified facts · {Object.keys(pendingFacts).length} unverified · {(testJob.config.employment_offerings || []).length} employment offerings</p>
                      {Object.entries(jobFacts).length > 0 && <dl className="mt-2 grid gap-1">
                        {Object.entries(jobFacts).map(([key,value]) => <div key={key}><dt className="inline capitalize text-text-secondary">{key.replaceAll("_"," ")} · </dt><dd className="inline">{value}</dd></div>)}
                      </dl>}
                      {!Object.keys(jobFacts).length && !testJob.config.employment_offerings?.length && (
                        <p className="mt-1 text-text-secondary">Employment terms are unspecified. The interviewer will refer questions to the hiring team.</p>
                      )}
                    </div>
                  )}
                  {onJobFacts && <button type="button" className="btn-secondary justify-self-start"
                    disabled={dirty} onClick={() => onJobFacts(testJob,selected)}>
                    {testJob ? "Edit Job Facts" : "Set up a job"}
                  </button>}
                </div>
              </RecruitmentSection>
            )}
            {editing && step === "preview" && (
              <>
                <RecruitmentSection title="Publication checks" className="mt-3">
                  {issues.length ? <ul className="list-disc space-y-1 pl-5 text-sm text-text-secondary">{issues.map(issue => <li key={issue}>{issue}</li>)}</ul>
                    : <p className="text-sm">The required assessment fields are complete.</p>}
                  {Object.keys(pendingFacts).length > 0 && <p className="mt-2 text-sm text-text-secondary">Unverified job terms stay out of the interview.</p>}
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button type="button" className="btn-secondary" disabled={dirty || issues.length > 0 || !testJob}
                      onClick={startTest}>Create test interview</button>
                    <button type="button" className="btn-primary" disabled={dirty || issues.length > 0}
                      onClick={publish}>Publish {selected.name} v{selected.version}</button>
                  </div>
                  {testLink && <div className="mt-3 flex flex-wrap items-center gap-3 text-sm" role="status">
                    <a className="btn-secondary" target="_blank" rel="noreferrer" href={testLink.url}>Open test interview</a>
                    <span>Draft revision {testLink.revision} · Expires {formatRecruitmentTime(testLink.expires_at)}</span>
                  </div>}
                </RecruitmentSection>
                <InterviewIntelligenceBuilder definition={current} version={selected.version} unpublished />
              </>
            )}
          </fieldset>
          {!isDraft && (
            <section
              className="recruitment-profile-history"
              aria-labelledby="profile-history-title"
            >
              <h2 id="profile-history-title">Version History</h2>
              <p className="text-xs text-text-secondary">
                Published versions stay fixed. Existing invitations retain their
                selected plan.
              </p>
              <ol className="mt-3 divide-y divide-border">
                {versions.map((p) => (
                  <li key={p.id}>
                    <button
                      className="recruitment-attention-row"
                      onClick={() => view(p.id)}
                      aria-current={p.id === versionId ? "true" : undefined}
                    >
                      <span>
                        Version {p.version}
                        {p.id === latest.id ? " · Latest" : ""}
                        {p.id === versionId ? " · Viewing" : ""}
                      </span>
                      <RecruitmentState value={p.status || "published"} />
                    </button>
                  </li>
                ))}
              </ol>
            </section>
          )}
          {canManage && (
            <RecruitmentSection title="Test interviews" className="mt-3">
              <button type="button" className="btn-secondary" disabled={locked} onClick={loadTestHistory}>
                {testHistory ? "Refresh test interviews" : "View recent tests"}
              </button>
              {testHistory?.length === 0 && <p className="mt-2 text-sm text-text-secondary">No tests have been created for this profile.</p>}
              {testHistory?.length > 0 && (
                <ul className="mt-2 divide-y divide-border">
                  {testHistory.map(test => (
                    <li key={test.attempt_id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                      <span>{test.workplace} · Draft revision {test.revision} · {interviewStateLabel(test.status)} · {formatRecruitmentTime(test.issued_at)}</span>
                      <div className="flex flex-wrap items-center gap-2">
                        <button type="button" className="btn-secondary" onClick={() => setTestReview(test)}>Review test</button>
                        {!test.revoked_at && Date.parse(test.expires_at) > Date.now() && (
                          <button type="button" className="btn-secondary" disabled={locked} onClick={() => revokeTest(test)}>Revoke test link</button>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </RecruitmentSection>
          )}
        </>
      )}
      {testReview && <RecruitmentEvidenceReview test application={{
        id:testReview.application_id,attemptId:testReview.attempt_id,name:"QA Interview Tester",contact:"",
      }} onClose={() => setTestReview(null)} />}
      {creation && (
        <Modal title={creation.sourceId ? "Duplicate interview profile" : "Create interview profile"} size="md"
          onClose={() => {if (!pending) setCreation(null);}}
          footer={<button className="btn-primary" disabled={pending || creation.name.trim().length < 3 ||
            !creation.positionId || !(creation.sourceId || creation.templateKey)} onClick={create}>Create draft</button>}>
          {error && <p className="mb-3 text-sm text-red-700" role="alert">{error}</p>}
          <div className="grid gap-4">
            {!creation.sourceId && <AdminFormField label="Interview template" required>
              <SelectField ariaLabel="Interview template" value={creation.templateKey}
                onChange={templateKey => setCreation({...creation,templateKey})}
                options={templates.map(t => ({value:t.key,label:t.name}))} placeholder="Select template" />
            </AdminFormField>}
            <AdminFormField label="Profile name" required>
              <input className="control w-full" value={creation.name} maxLength={120}
                onChange={e => setCreation({...creation,name:e.target.value})} />
            </AdminFormField>
            <AdminFormField label="Job Position" required>
              <SelectField ariaLabel="Job Position" value={creation.positionId}
                options={positions.map(p => ({value:p.id,label:p.name}))}
                onChange={positionId => setCreation({...creation,positionId})} placeholder="Select position" searchable />
            </AdminFormField>
          </div>
        </Modal>
      )}
    </>
  );
}
