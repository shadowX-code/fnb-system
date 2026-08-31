import { Children, useEffect, useRef, useState } from "react";
import { ArrowDown, ArrowUp, Award, ChevronRight, ClipboardCheck, GripVertical, Plus, RotateCcw, Search, ShieldCheck, Sparkles, Trash2, UsersRound } from "lucide-react";
import PageHeader from "../../../components/layout/PageHeader.jsx";
import Modal from "../../../components/feedback/Modal.jsx";
import Badge from "../../../components/ui/Badge.jsx";
import SelectField from "../../../components/forms/SelectField.jsx";
import MultiSelectField from "../../../components/forms/MultiSelectField.jsx";
import DataTable from "../../../components/tables/DataTable.jsx";
import { crewService } from "../../../services/crewService.js";
import { jobPositionService } from "../../../services/jobPositionService.js";
import CrewAdminToolbar, { CrewAdminOutletField } from "../components/CrewAdminToolbar.jsx";
import { useCrewAdminOutlet } from "../context/CrewAdminOutletContext.jsx";

const SKILL_CATEGORIES = Object.freeze(["Service", "Cashier", "Cleaning", "Opening & Closing", "Kitchen", "Leadership", "Other"]);
const SKILL_STATUSES = Object.freeze([{ value: "active", label: "Active" }, { value: "inactive", label: "Inactive" }]);
const CERTIFICATION_METHODS = Object.freeze([
  { value: "learning", label: "Learning" },
  { value: "learning_and_review", label: "Learning + Manager Review" },
  { value: "manager_review", label: "Manager Review" },
  { value: "manual", label: "Manual Certification" },
]);
const REQUIREMENT_TYPES = Object.freeze([
  { value: "module", label: "Complete onboarding module", methods: ["learning", "learning_and_review"] },
  { value: "lesson", label: "Complete lesson", methods: ["learning", "learning_and_review"] },
  { value: "sop", label: "Read / acknowledge SOP", methods: ["learning", "learning_and_review"] },
  { value: "quiz", label: "Pass knowledge check", methods: ["learning", "learning_and_review"] },
  { value: "practical", label: "Manager practical assessment", methods: ["learning_and_review", "manager_review"] },
  { value: "performance", label: "Performance target", methods: ["manual"] },
  { value: "manual", label: "Manual certification", methods: ["manual"] },
]);
const STATES = {
  not_started: "Not Started", in_progress: "In Progress", ready_for_review: "Ready for Review",
  certified: "Certified", needs_renewal: "Needs Renewal", expired: "Expired", not_applicable: "Not Applicable",
};
const allOption = { value: "all", label: "All" };
const stateTone = (state) => state === "certified" ? "success" : state === "ready_for_review" ? "info" : state === "expired" ? "danger" : state === "needs_renewal" ? "warning" : "neutral";
const formatDate = (value) => value ? new Date(value).toLocaleDateString("en-MY", { day: "numeric", month: "short", year: "numeric" }) : "-";
const statusText = (value) => STATES[value] || String(value || "").replaceAll("_", " ");
const compactNumber = (value) => new Intl.NumberFormat("en-MY").format(Number(value || 0));

export default function CrewGrowthAdminPage({ auth, ui, store, initialTab = "overview" }) {
  const activeTab = initialTab === "skills" ? "skills" : "overview";
  const { outlets, outletId, setOutletId } = useCrewAdminOutlet(store?.outlets || []);
  const [data, setData] = useState({ skills: [], crew: [], reviews: [], recent_certifications: [] });
  const [evidence, setEvidence] = useState([]);
  const [positions, setPositions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [savingSkill, setSavingSkill] = useState(false);
  const [error, setError] = useState("");
  const [skillEditor, setSkillEditor] = useState(null);
  const [employeeProfile, setEmployeeProfile] = useState(null);
  const [review, setReview] = useState(null);
  const requestId = useRef(0);
  const canManage = auth.hasPermission("crew_growth.manage");
  const canAssess = auth.hasPermission("crew_growth.assess");
  const canCertify = auth.hasPermission("crew_growth.certify");

  async function refresh() {
    if (!outletId) return;
    const currentRequest = ++requestId.current;
    setLoading(true);
    setError("");
    try {
      const [growth, growthEvidence] = await Promise.all([
        crewService.growthAdminData(outletId),
        activeTab === "skills" ? crewService.growthAdminEvidence(outletId) : Promise.resolve([]),
      ]);
      if (currentRequest !== requestId.current) return;
      setData(growth);
      setEvidence(growthEvidence);
    } catch (cause) {
      if (currentRequest !== requestId.current) return;
      setError(cause.message || "Growth data could not be loaded.");
      ui.notify({ title: "Unable to load Crew Growth", message: cause.message, tone: "error" });
    } finally {
      if (currentRequest === requestId.current) setLoading(false);
    }
  }

  useEffect(() => { refresh(); }, [activeTab, outletId]);
  useEffect(() => {
    let ignore = false;
    jobPositionService.listJobPositions()
      .then((rows) => { if (!ignore) setPositions((rows || []).filter((row) => row.status !== "inactive")); })
      .catch(() => { if (!ignore) setPositions([]); });
    return () => { ignore = true; };
  }, []);

  async function saveSkill(payload) {
    setSavingSkill(true);
    try {
      await crewService.saveGrowthSkill({ ...payload, outlet_id: outletId });
      setSkillEditor(null);
      await refresh();
      ui.notify({ title: "Skill saved", message: "Applicability and certification requirements are now authoritative." });
    } catch (cause) {
      ui.notify({ title: "Unable to save skill", message: cause.message, tone: "error" });
      throw cause;
    } finally {
      setSavingSkill(false);
    }
  }
  async function submitAssessment(values) {
    try {
      await crewService.submitGrowthAssessment(values);
      await refresh();
      setReview(null);
      ui.notify({ title: values.result === "pass" ? "Assessment passed" : "Improvement recorded", message: "Assessment history has been retained." });
    } catch (cause) { ui.notify({ title: "Unable to save assessment", message: cause.message, tone: "error" }); throw cause; }
  }
  async function certify(values) {
    try {
      await crewService.certifyGrowthSkill(values);
      setReview(null);
      await refresh();
      ui.notify({ title: "Crew skill certified", message: "A versioned certification history record was created." });
    } catch (cause) { ui.notify({ title: "Unable to certify skill", message: cause.message, tone: "error" }); throw cause; }
  }

  const outlet = outlets.find((item) => item.id === outletId);
  const header = activeTab === "skills"
    ? { title: "Skills", description: "Define outlet capabilities, applicability and server-derived certification requirements." }
    : { title: "Growth Overview", description: "Review certification readiness and team capability in one operational view." };
  const outletSelect = <CrewAdminOutletField ariaLabel="Outlet" value={outletId} onChange={setOutletId} options={outlets.map((item) => ({ value: item.id, label: item.name }))} />;
  const fallbackPositions = [...new Set([...data.crew.map((row) => row.employee?.position), ...data.skills.flatMap((skill) => skill.positions || [])].filter(Boolean))].sort();
  const positionOptions = mergePositionOptions(positions, fallbackPositions);

  return <div className="crew-growth-page">
    <PageHeader section="Crew · Growth" title={header.title} description={header.description} />
    {loading ? <><CrewAdminToolbar outlet={outletSelect} /><GrowthSkeleton /></> : error ? <><CrewAdminToolbar outlet={outletSelect} /><GrowthError message={error} onRetry={refresh} /></> : activeTab === "skills" ? <SkillsLibrary data={data} canManage={canManage} onView={setSkillEditor} outletSelect={outletSelect} onCreate={() => setSkillEditor({})} positionOptions={positionOptions} /> : <GrowthOverview data={data} outletSelect={outletSelect} onOpenReview={setReview} onOpenEmployee={setEmployeeProfile} />}
    {skillEditor ? <SkillEditor skill={skillEditor} evidence={evidence} outlet={outlet} positionOptions={positionOptions} saving={savingSkill} onClose={() => setSkillEditor(null)} onSave={saveSkill} /> : null}
    {employeeProfile ? <CrewGrowthProfile row={employeeProfile} onClose={() => setEmployeeProfile(null)} onReview={(item) => { setEmployeeProfile(null); setReview(item); }} /> : null}
    {review ? <CertificationReview item={review} canAssess={canAssess} canCertify={canCertify} onClose={() => setReview(null)} onAssess={submitAssessment} onCertify={certify} /> : null}
  </div>;
}

function flattenStates(data) { return (data.crew || []).flatMap((row) => (row.skills || []).map((state) => ({ ...state, employee: row.employee, skill: data.skills.find((skill) => skill.id === state.skill_id) }))); }
function mergePositionOptions(positions, fallbackPositions) {
  const names = new Set([...(positions || []).map((row) => row.name), ...(fallbackPositions || [])].filter(Boolean));
  return [...names].sort().map((name) => ({ value: name, label: name }));
}

function GrowthOverview({ data, outletSelect, onOpenReview, onOpenEmployee }) {
  const [query, setQuery] = useState("");
  const [position, setPosition] = useState("all");
  const [status, setStatus] = useState("all");
  const states = flattenStates(data).filter((row) => row.applicable);
  const activeCrew = data.crew.length;
  const certified = new Set(states.filter((row) => row.status === "certified").map((row) => row.employee_id)).size;
  const attention = new Set(states.filter((row) => ["ready_for_review", "needs_renewal", "expired"].includes(row.status)).map((row) => row.employee_id)).size;
  const positions = [...new Set(data.crew.map((row) => row.employee.position).filter(Boolean))].sort();
  const crewRows = data.crew.map((row) => ({ ...row, skills: row.skills.map((state) => ({ ...state, skill: data.skills.find((skill) => skill.id === state.skill_id) })), summary: summarize(row.skills) })).filter((row) => `${row.employee.full_name} ${row.employee.employee_code || ""}`.toLowerCase().includes(query.toLowerCase()) && (position === "all" || row.employee.position === position) && (status === "all" || growthStatus(row.summary) === status));
  const coverageRows = data.skills.filter((skill) => skill.status === "active").map((skill) => { const eligible = states.filter((row) => row.skill_id === skill.id); const count = eligible.filter((row) => row.status === "certified").length; return { skill, eligible: eligible.length, count, percent: eligible.length ? Math.round(count * 100 / eligible.length) : 0 }; }).sort((a, b) => a.percent - b.percent || b.eligible - a.eligible || a.skill.name.localeCompare(b.skill.name)).slice(0, 4);
  const reviewRows = (data.reviews || []).filter((row) => row.state?.status === "ready_for_review");
  const clearFilters = () => { setQuery(""); setPosition("all"); setStatus("all"); };

  return <div className="crew-growth-stack">
    <FilterBar>{outletSelect}<SearchField label="Search Crew" value={query} onChange={setQuery} placeholder="Search by name or employee code" /><SelectField label="Position" value={position} onChange={setPosition} options={[allOption, ...positions.map((value) => ({ value, label: value }))]} /><SelectField label="Growth Status" value={status} onChange={setStatus} options={[allOption, { value: "on_track", label: "On Track" }, { value: "attention", label: "Needs Attention" }, { value: "not_started", label: "Not Started" }]} /><button className="btn-secondary crew-growth-clear" type="button" disabled={!query && position === "all" && status === "all"} onClick={clearFilters}><RotateCcw size={14} /> Clear</button></FilterBar>
    <section className="crew-growth-metrics" aria-label="Growth metrics"><Metric icon={UsersRound} label="Active Crew" value={compactNumber(activeCrew)} detail="Selected outlet" /><Metric icon={Award} label="Certified Crew" value={compactNumber(certified)} detail="At least one current certification" tone="success" /><Metric icon={ClipboardCheck} label="Needs Review / Attention" value={compactNumber(attention)} detail="Actionable review or renewal risk" tone={attention ? "warning" : "success"} /></section>
    {reviewRows.length ? <NeedsReviewSection rows={reviewRows} onOpenReview={onOpenReview} /> : null}
    <section className="crew-growth-table crew-growth-crew-table"><SectionHead title="Crew Growth" detail={`${crewRows.length} of ${activeCrew} active Crew`} />{crewRows.length ? <DataTable rows={crewRows} getRowKey={(row) => row.employee.id} onRowClick={onOpenEmployee} tableClassName="min-w-[980px]" columns={crewColumns(onOpenEmployee, onOpenReview)} /> : <Empty title={data.crew.length ? "No Crew match these filters" : "No active Crew in this outlet"} detail={data.crew.length ? "Clear or adjust the filters to see more Crew." : "Active Crew capability profiles will appear here."} />}</section>
    <div className="crew-growth-overview-grid"><SkillCoverage rows={coverageRows} />{data.recent_certifications.length ? <RecentCertifications rows={data.recent_certifications.slice(0, 5)} /> : null}</div>
  </div>;
}

function NeedsReviewSection({ rows, onOpenReview }) {
  return <section className="crew-growth-table crew-growth-review-queue"><SectionHead title="Needs Review" detail={`${rows.length} certification ${rows.length === 1 ? "review" : "reviews"} ready`} /> <DataTable density="compact" rows={rows} getRowKey={(row) => `${row.employee_id}:${row.skill_id}`} tableClassName="min-w-[820px]" columns={[
    { key: "employee", header: "Employee", render: (row) => <NameCell title={row.employee_name} detail={row.position} /> },
    { key: "skill", header: "Skill", render: (row) => row.skill_name },
    { key: "progress", header: "Evidence / Requirements", render: (row) => `${row.state.requirements_completed} / ${row.state.requirements_total} complete` },
    { key: "status", header: "Status", render: (row) => <StateBadge state={row.state.status} /> },
    { key: "action", header: "Review", align: "right", render: (row) => <button className="btn-primary px-3 py-1.5 text-xs" onClick={() => onOpenReview(row)}>Review</button> },
  ]} /></section>;
}

function crewColumns(onOpenEmployee, onOpenReview) { return [
  { key: "employee", header: "Employee", render: (row) => <NameCell title={row.employee.full_name} detail={row.employee.employee_code || row.employee.position} /> },
  { key: "position", header: "Position", render: (row) => row.employee.position || "-" },
  { key: "certified", header: "Certified", render: (row) => row.summary.certified },
  { key: "progress", header: "In Progress", render: (row) => row.summary.inProgress },
  { key: "ready", header: "Pending Review / Attention", render: (row) => row.summary.attention ? <button className="crew-growth-inline-action" type="button" onClick={() => onOpenReview(firstActionableSkill(row))}>{row.summary.attention} review</button> : "0" },
  { key: "last", header: "Last Certification", render: (row) => formatDate(latestCertification(row.skills)) },
  { key: "status", header: "Growth Status", render: (row) => <Badge tone={growthStatus(row.summary) === "attention" ? "warning" : growthStatus(row.summary) === "on_track" ? "success" : "neutral"}>{growthStatus(row.summary) === "attention" ? "Needs Attention" : growthStatus(row.summary) === "on_track" ? "On Track" : "Not Started"}</Badge> },
  { key: "open", header: "", align: "right", render: (row) => <button className="icon-btn" aria-label={`View ${row.employee.full_name} growth`} onClick={() => onOpenEmployee(row)}><ChevronRight size={16} /></button> },
]; }

function SkillCoverage({ rows }) {
  return <section className="crew-growth-section"><SectionHead title="Skill Coverage" detail="Lowest certified coverage among active skills" /><div className="crew-growth-coverage"><div className="crew-growth-coverage-head"><span>Skill</span><span>Certified</span><span>Coverage</span></div>{rows.map(({ skill, count, eligible, percent }) => <article key={skill.id}><strong>{skill.name}</strong><span>{count} / {eligible}</span><div className="crew-growth-progress"><i style={{ width: `${percent}%` }} /><b>{percent}%</b></div></article>)}{!rows.length ? <Empty title="No skills configured" detail="Create the first outlet skill in Skills." /> : null}</div></section>;
}

function RecentCertifications({ rows }) {
  return <section className="crew-growth-section"><SectionHead title="Recent Certifications" detail="Latest immutable certification records" /><DataTable density="compact" rows={rows} getRowKey={(row) => row.id} tableClassName="min-w-[620px]" columns={[
    { key: "employee", header: "Employee", render: (row) => <NameCell title={row.employee_name} /> },
    { key: "skill", header: "Skill", render: (row) => row.skill_name },
    { key: "date", header: "Certified", render: (row) => formatDate(row.certified_at) },
    { key: "by", header: "By", render: (row) => row.certified_by },
  ]} /></section>;
}

function SkillsLibrary({ data, canManage, onView, outletSelect, onCreate, positionOptions }) {
  const [query, setQuery] = useState(""); const [category, setCategory] = useState("all"); const [position, setPosition] = useState("all"); const [status, setStatus] = useState("all");
  const rows = data.skills.filter((skill) => `${skill.name} ${skill.description || ""}`.toLowerCase().includes(query.toLowerCase()) && (category === "all" || skill.category === category) && (position === "all" || (skill.positions || []).includes(position)) && (status === "all" || skill.status === status));
  const states = flattenStates(data);
  return <div className="crew-growth-stack">
    <FilterBar outlet={outletSelect} primary={canManage ? <button className="btn-primary" onClick={onCreate}><Plus size={15} /> New Skill</button> : null}>
      <SearchField label="Search" value={query} onChange={setQuery} placeholder="Search skills" />
      <SelectField label="Category" value={category} onChange={setCategory} options={[allOption, ...SKILL_CATEGORIES.map((value) => ({ value, label: value }))]} />
      <SelectField label="Position" value={position} onChange={setPosition} options={[allOption, ...positionOptions]} />
      <SelectField label="Status" value={status} onChange={setStatus} options={[allOption, ...SKILL_STATUSES]} />
    </FilterBar>
    <section className="crew-growth-table"><DataTable rows={rows} getRowKey={(row) => row.id} onRowClick={onView} tableClassName="min-w-[960px]" columns={[
      { key: "skill", header: "Skill + Description", render: (row) => <NameCell title={row.name} detail={row.description || "No description"} /> },
      { key: "category", header: "Category" },
      { key: "positions", header: "Applicable Positions", render: (row) => row.positions?.length ? row.positions.join(", ") : "All active Crew" },
      { key: "method", header: "Certification Method", render: (row) => methodLabel(row.certification_method) },
      { key: "certified", header: "Certified Crew", render: (row) => { const eligible = states.filter((state) => state.skill_id === row.id && state.applicable); return `${eligible.filter((state) => state.status === "certified").length} / ${eligible.length}`; } },
      { key: "status", header: "Status", render: (row) => <Badge tone={row.status === "active" ? "success" : "neutral"}>{row.status === "active" ? "Active" : "Inactive"}</Badge> },
      { key: "actions", header: "Actions", align: "right", render: (row) => <button className="btn-secondary px-3 py-1.5 text-xs" onClick={() => onView(row)}>{canManage ? "View / Edit" : "View"}</button> },
    ]} /></section>
  </div>;
}

function SkillEditor({ skill, evidence, outlet, positionOptions, saving, onClose, onSave }) {
  const [form, setForm] = useState(() => ({ id: skill.id || "", name: skill.name || "", category: skill.category || "Service", description: skill.description || "", status: skill.status || "active", certification_method: skill.certification_method || "learning_and_review", validity_months: skill.validity_months || "", positions: skill.positions || [], outlets: skill.outlets?.length ? skill.outlets : outlet?.id ? [outlet.id] : [], requirements: normalizeRequirements(skill.requirements || []) }));
  const [expiryMode, setExpiryMode] = useState(form.validity_months ? "months" : "none");
  const set = (patch) => setForm((current) => ({ ...current, ...patch }));
  const allowedTypes = requirementOptions(form.certification_method);
  const validation = validateSkill(form, expiryMode);
  const addRequirement = () => set({ requirements: [...form.requirements, blankRequirement(allowedTypes[0]?.value || "manual")] });
  const changeRequirement = (index, patch) => set({ requirements: form.requirements.map((row, i) => i === index ? normalizeRequirementPatch({ ...row, ...patch }) : row) });
  const moveRequirement = (index, offset) => {
    const next = [...form.requirements];
    const [row] = next.splice(index, 1);
    next.splice(index + offset, 0, row);
    set({ requirements: next });
  };
  const submit = () => {
    if (validation) return;
    onSave({ ...form, validity_months: expiryMode === "none" ? "" : String(form.validity_months), requirements: form.requirements.map((row) => ({ ...row, label: row.label || evidence.find((item) => item.id === row.reference_id)?.label || requirementLabel(row.type) })) });
  };

  return <Modal title={skill.id ? "Edit Skill" : "New Skill"} description={`${outlet?.name || "Outlet"} · Versioned certification requirements`} size="2xl" onClose={onClose} bodyClassName="crew-growth-skill-editor" footer={<div className="crew-growth-editor-footer"><span>{validation || "Editing published skills creates the next requirements version for future evidence."}</span><div><button className="btn-secondary" onClick={onClose}>Cancel</button><button className="btn-primary" disabled={saving || Boolean(validation)} onClick={submit}>{saving ? "Saving..." : "Save Skill"}</button></div></div>}>
    <section className="crew-growth-form-section"><h3>Basic Information</h3><div className="crew-growth-form-grid"><Field label="Skill Name" required><input aria-label="Skill Name" className="control" value={form.name} onChange={(event) => set({ name: event.target.value })} /></Field><SelectField label="Category" value={form.category} onChange={(category) => set({ category })} options={SKILL_CATEGORIES.map((value) => ({ value, label: value }))} required /><Field label="Description" className="is-wide"><textarea className="control" value={form.description} onChange={(event) => set({ description: event.target.value })} /></Field></div></section>
    <section className="crew-growth-form-section"><h3>Applicability</h3><MultiSelectField label="Applicable Positions" value={form.positions} options={mergeExistingOptions(positionOptions, form.positions)} onApply={(positions) => set({ positions })} placeholder="All active Crew" /><p className="crew-growth-field-note">Leaving this empty applies the skill to all active Crew in the selected outlet.</p></section>
    <section className="crew-growth-form-section"><h3>Certification</h3><div className="crew-growth-form-grid"><SelectField label="Status" value={form.status} onChange={(status) => set({ status })} options={SKILL_STATUSES} /><SelectField label="Certification Method" value={form.certification_method} onChange={(certification_method) => set({ certification_method, requirements: normalizeRequirementsForMethod(form.requirements, certification_method) })} options={CERTIFICATION_METHODS} /><SelectField label="Certification Validity" value={expiryMode} onChange={setExpiryMode} options={[{ value: "none", label: "No Expiry" }, { value: "months", label: "Expiry after X months" }]} />{expiryMode === "months" ? <Field label="Expiry Months" required><input aria-label="Expiry Months" className="control" type="number" min="1" max="120" value={form.validity_months} onChange={(event) => set({ validity_months: event.target.value })} /></Field> : null}</div></section>
    <section className="crew-growth-requirements-editor"><header><div><h3>Certification Requirements</h3><p>Configure the evidence the server will evaluate before certification.</p></div><button className="btn-secondary" onClick={addRequirement}><Plus size={14} /> Add Requirement</button></header>{form.requirements.map((row, index) => <RequirementRow key={`${row.id || "new"}:${index}`} row={row} index={index} evidence={evidence} allowedTypes={allowedTypes} onChange={(patch) => changeRequirement(index, patch)} onMove={moveRequirement} onDelete={() => set({ requirements: form.requirements.filter((_, i) => i !== index) })} canMoveUp={index > 0} canMoveDown={index < form.requirements.length - 1} />)}{!form.requirements.length ? <Empty title="No requirements yet" detail="Add learning, SOP, quiz, practical or manual evidence." /> : null}</section>
  </Modal>;
}

function RequirementRow({ row, index, evidence, allowedTypes, onChange, onMove, onDelete, canMoveUp, canMoveDown }) {
  const needsEvidence = ["module", "lesson", "sop", "quiz"].includes(row.type);
  const options = evidence.filter((item) => item.type === row.type).map((item) => ({ value: item.id, label: item.label }));
  return <article><span className="crew-growth-drag"><GripVertical size={14} />{index + 1}</span><SelectField label="Requirement Type" value={row.type} onChange={(type) => onChange({ type, reference_id: "", label: requirementLabel(type), config: {} })} options={allowedTypes} />{needsEvidence ? <SelectField searchable label="Evidence" value={row.reference_id || ""} onChange={(reference_id) => onChange({ reference_id, label: evidence.find((item) => item.id === reference_id)?.label || "" })} options={options} placeholder="Select published evidence" /> : <Field label={row.type === "practical" ? "Assessment Name" : "Requirement Label"}><input className="control" value={row.label || ""} onChange={(event) => onChange({ label: event.target.value })} /></Field>}{row.type === "practical" ? <Field label="Assessment Checklist" className="is-wide"><textarea className="control" value={(row.config?.items || []).join("\n")} onChange={(event) => onChange({ config: { ...(row.config || {}), items: event.target.value.split("\n").map((item) => item.trim()).filter(Boolean) } })} placeholder="One observable standard per line" /></Field> : null}<label className="crew-growth-required"><input type="checkbox" checked={row.required !== false} onChange={(event) => onChange({ required: event.target.checked })} /> Required</label><div className="crew-growth-requirement-actions"><button className="icon-btn" aria-label={`Move requirement ${index + 1} up`} disabled={!canMoveUp} onClick={() => onMove(index, -1)}><ArrowUp size={14} /></button><button className="icon-btn" aria-label={`Move requirement ${index + 1} down`} disabled={!canMoveDown} onClick={() => onMove(index, 1)}><ArrowDown size={14} /></button><button className="icon-btn is-danger" aria-label={`Delete requirement ${index + 1}`} onClick={onDelete}><Trash2 size={14} /></button></div></article>;
}

function CrewGrowthProfile({ row, onClose, onReview }) {
  const summary = summarize(row.skills);
  return <Modal title="Crew Growth Profile" description="Durable skill progress and certification history" size="xl" onClose={onClose} footer={<button className="btn-secondary" onClick={onClose}>Close</button>} panelClassName="crew-growth-profile-modal"><div className="crew-growth-profile"><section className="crew-growth-profile-identity"><InitialAvatar name={row.employee.full_name} size="lg" /><div><h3>{row.employee.full_name}</h3><p>{row.employee.position || "Crew"}</p><span>{row.employee.employee_code || "Active Crew"}</span></div><Badge tone="success">Active</Badge></section><section className="crew-growth-profile-summary"><Metric icon={null} label="Certified" value={summary.certified} /><Metric icon={null} label="In Progress" value={summary.inProgress} /><Metric icon={null} label="Needs Review" value={summary.ready} /><Metric icon={null} label="Not Started" value={row.skills.filter((state) => state.status === "not_started").length} /></section><div className="crew-growth-profile-list"><header><strong>Skill Progress</strong><span>{row.skills.length} skills</span></header>{row.skills.map((state) => <button key={state.skill_id} onClick={() => onReview({ employee_id: row.employee.id, employee_name: row.employee.full_name, position: row.employee.position, skill_id: state.skill_id, skill_name: state.skill?.name || "Skill", state })}><span><strong>{state.skill?.name || "Skill"}</strong><small>{state.status === "certified" ? `Certified ${formatDate(state.certification?.certified_at)}` : `${state.requirements_completed} / ${state.requirements_total} requirements complete`}</small></span><div className="crew-growth-skill-row-progress"><i style={{ width: `${state.requirements_total ? Math.round(state.requirements_completed * 100 / state.requirements_total) : 0}%` }} /></div><StateBadge state={state.status} /><ChevronRight size={15} /></button>)}</div></div></Modal>;
}

function CertificationReview({ item, canAssess, canCertify, onClose, onAssess, onCertify }) {
  const [checklist, setChecklist] = useState(() => practicalItems(item).map((label) => ({ label, rating: "meets_standard" })));
  const [note, setNote] = useState(""); const [saving, setSaving] = useState(false);
  const passPractical = checklist.every((row) => row.rating === "meets_standard");
  const state = item.state;
  const assess = async () => { setSaving(true); try { await onAssess({ employeeId: item.employee_id, skillId: item.skill_id, result: passPractical ? "pass" : "needs_improvement", checklist, note }); } finally { setSaving(false); } };
  const certify = async () => { setSaving(true); try { await onCertify({ employeeId: item.employee_id, skillId: item.skill_id, note }); } finally { setSaving(false); } };
  return <Modal title="Practical Assessment" description={`${item.skill_name} · ${item.employee_name}`} size="2xl" onClose={onClose} panelClassName="crew-growth-assessment-modal" footer={<><button className="btn-secondary" onClick={onClose}>Cancel</button>{canAssess && state.requirements.some((row) => row.type === "practical") ? <button className="btn-primary" disabled={saving} onClick={assess}>{passPractical ? "Submit Assessment" : "Record Improvement"}</button> : null}{canCertify ? <button className="btn-secondary" disabled={saving || !eligibleToCertify(state)} onClick={certify}>Certify Skill</button> : null}</>}><div className="crew-growth-review"><header><div><NameCell title={item.employee_name} detail={item.position || "Crew"} /><span>{state.requirements_completed} / {state.requirements_total} requirements complete</span></div><StateBadge state={state.status} /></header><div className="crew-growth-review-grid"><section className="crew-growth-evidence-panel"><h3>Requirements Checklist</h3>{state.requirements.map((row) => <article key={row.requirement_id}><span className={row.completed ? "is-done" : ""}>{row.completed ? "✓" : "○"}</span><div><strong>{row.label}</strong><small>{row.detail}</small></div>{row.score != null ? <Badge tone="info">{row.score}%</Badge> : <StateBadge state={row.completed ? "certified" : row.type === "practical" ? "ready_for_review" : "not_started"} />}</article>)}</section>{state.requirements.some((row) => row.type === "practical") ? <section className="crew-growth-practical-panel"><div className="crew-growth-assessment-head"><div><h3>Assessment Checklist</h3><p>Observe the Crew member during actual work.</p></div><div className={`crew-growth-result is-${passPractical ? "pass" : "improve"}`}><strong>{passPractical ? "Pass" : "Needs Improvement"}</strong><span>{passPractical ? "Meets the standard" : "Further coaching required"}</span></div></div>{checklist.map((row, index) => <div className="crew-growth-assessment-row" key={row.label}><strong>{row.label}</strong><div className="crew-growth-rating" role="group" aria-label={`${row.label} rating`}>{[{ value: "meets_standard", label: "Meets Standard" }, { value: "needs_improvement", label: "Needs Improvement" }, { value: "not_observed", label: "Not Observed" }].map((option) => <button key={option.value} className={row.rating === option.value ? "is-active" : ""} type="button" aria-pressed={row.rating === option.value} onClick={() => setChecklist((current) => current.map((entry, i) => i === index ? { ...entry, rating: option.value } : entry))}>{option.label}</button>)}</div></div>)}<Field label="Manager Note"><textarea className="control" value={note} onChange={(event) => setNote(event.target.value)} placeholder="Optional assessment or certification note" /></Field></section> : null}</div></div></Modal>;
}

function blankRequirement(type) { return { type, reference_id: "", label: requirementLabel(type), required: true, config: type === "practical" ? { items: [] } : {} }; }
function normalizeRequirements(rows) { return rows.map((row) => normalizeRequirementPatch({ ...row, type: row.type || "module", label: row.label || requirementLabel(row.type || "module"), required: row.required !== false, config: row.config || {} })); }
function normalizeRequirementPatch(row) { return { ...row, config: row.type === "practical" ? { items: row.config?.items || [] } : (row.config || {}) }; }
function normalizeRequirementsForMethod(rows, method) {
  const allowed = new Set(requirementOptions(method).map((row) => row.value));
  return rows.filter((row) => allowed.has(row.type));
}
function requirementOptions(method) { return REQUIREMENT_TYPES.filter((row) => row.methods.includes(method)).map(({ value, label }) => ({ value, label })); }
function mergeExistingOptions(options, selected) {
  const values = new Map(options.map((option) => [option.value, option]));
  selected.forEach((value) => { if (!values.has(value)) values.set(value, { value, label: value }); });
  return [...values.values()];
}
function validateSkill(form, expiryMode) {
  if (!form.name.trim()) return "Skill name is required.";
  if (!SKILL_CATEGORIES.includes(form.category)) return "Select a supported category.";
  if (!SKILL_STATUSES.some((row) => row.value === form.status)) return "Select a supported status.";
  if (!CERTIFICATION_METHODS.some((row) => row.value === form.certification_method)) return "Select a supported certification method.";
  if (expiryMode === "months" && (!Number.isInteger(Number(form.validity_months)) || Number(form.validity_months) < 1 || Number(form.validity_months) > 120)) return "Expiry must be 1 to 120 months.";
  const allowed = new Set(requirementOptions(form.certification_method).map((row) => row.value));
  const invalidRequirement = form.requirements.find((row) => !allowed.has(row.type));
  if (invalidRequirement) return "A requirement does not match the selected certification method.";
  const missingEvidence = form.requirements.find((row) => ["module", "lesson", "sop", "quiz"].includes(row.type) && !row.reference_id);
  if (missingEvidence) return "Select published evidence for every learning requirement.";
  return "";
}
function practicalItems(item) { const configured = item.state.requirements.find((row) => row.type === "practical")?.config?.items; return configured?.length ? configured : ["Demonstrates the standard consistently", "Uses the correct sequence", "Works safely and independently"]; }
function eligibleToCertify(state) { return state.applicable && state.requirements.every((row) => !row.required || ["manual", "performance"].includes(row.type) || row.completed); }
function requirementLabel(type) { return ({ module: "Complete onboarding module", lesson: "Complete lesson", sop: "Read / acknowledge SOP", quiz: "Pass knowledge check", practical: "Manager practical assessment", performance: "Performance target", manual: "Manual certification" })[type] || "Requirement"; }
function methodLabel(value) { return CERTIFICATION_METHODS.find((row) => row.value === value)?.label || value; }
function summarize(skills = []) { return { certified: skills.filter((row) => row.status === "certified").length, inProgress: skills.filter((row) => row.status === "in_progress").length, ready: skills.filter((row) => row.status === "ready_for_review").length, attention: skills.filter((row) => ["ready_for_review", "needs_renewal", "expired"].includes(row.status)).length }; }
function growthStatus(summary) { return summary.attention ? "attention" : summary.certified || summary.inProgress ? "on_track" : "not_started"; }
function latestCertification(skills = []) { return skills.map((row) => row.certification?.certified_at).filter(Boolean).sort().at(-1); }
function firstActionableSkill(row) { const state = row.skills.find((item) => ["ready_for_review", "needs_renewal", "expired"].includes(item.status)) || row.skills[0]; return { employee_id: row.employee.id, employee_name: row.employee.full_name, position: row.employee.position, skill_id: state.skill_id, skill_name: state.skill?.name || "Skill", state }; }
function StateBadge({ state }) { return <Badge tone={stateTone(state)}>{statusText(state)}</Badge>; }
function InitialAvatar({ name, size = "sm" }) { const initials = String(name || "Crew").split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase(); return <span className={`crew-growth-avatar is-${size}`} aria-hidden="true">{initials}</span>; }
function NameCell({ title, detail }) { return <span className="crew-growth-name"><InitialAvatar name={title} /><span><strong>{title}</strong><small>{detail || "-"}</small></span></span>; }
function Metric({ icon: Icon = Sparkles, label, value, detail, tone = "neutral" }) { return <article className={`crew-growth-metric is-${tone}`}><div className="crew-growth-metric-icon">{Icon ? <Icon size={16} /> : null}</div><span><small>{label}</small><strong>{value}</strong>{detail ? <em>{detail}</em> : null}</span></article>; }
function SectionHead({ title, detail, action = null }) { return <header className="crew-growth-section-head"><div><h2>{title}</h2><p>{detail}</p></div>{action}</header>; }
function FilterBar({ children, outlet = null, primary = null }) {
  const controls = Children.toArray(children);
  const embeddedOutlet = controls.find((child) => child?.type === CrewAdminOutletField);
  return <CrewAdminToolbar outlet={outlet || embeddedOutlet || null} primary={primary}>{controls.filter((child) => child !== embeddedOutlet)}</CrewAdminToolbar>;
}
function SearchField({ label, value, onChange, placeholder }) { return <label className="crew-growth-search"><span>{label}</span><div><Search size={15} /><input value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} /></div></label>; }
function Field({ label, required = false, className = "", children }) { return <label className={className}>{label} {required ? <span className="text-rose-500">*</span> : null}{children}</label>; }
function Empty({ title, detail }) { return <div className="crew-growth-empty"><ShieldCheck size={22} /><strong>{title}</strong><span>{detail}</span></div>; }
function GrowthError({ message, onRetry }) { return <section className="crew-growth-error" role="alert"><ShieldCheck size={24} /><div><strong>Unable to load Growth</strong><span>{message}</span></div><button className="btn-secondary" onClick={onRetry}>Retry</button></section>; }
function GrowthSkeleton() { return <div className="crew-growth-skeleton"><span /><span /><span /><p>Loading Growth...</p></div>; }
