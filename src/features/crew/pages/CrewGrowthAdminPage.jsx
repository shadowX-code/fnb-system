import { useEffect, useMemo, useState } from "react";
import { Award, CheckCircle2, ChevronRight, ClipboardCheck, Plus, Search, ShieldCheck, Sparkles, UserRoundCheck, UsersRound } from "lucide-react";
import PageHeader from "../../../components/layout/PageHeader.jsx";
import Modal from "../../../components/feedback/Modal.jsx";
import Badge from "../../../components/ui/Badge.jsx";
import SelectField from "../../../components/forms/SelectField.jsx";
import DataTable from "../../../components/tables/DataTable.jsx";
import { crewService } from "../../../services/crewService.js";
import { outletService } from "../../../services/outletService.js";

const CATEGORIES = ["Service", "Cashier", "Cleaning", "Opening & Closing", "Kitchen", "Leadership", "Other"];
const STATES = {
  not_started: "Not Started", in_progress: "In Progress", ready_for_review: "Ready for Review",
  certified: "Certified", needs_renewal: "Needs Renewal", expired: "Expired", not_applicable: "Not Applicable",
};
const stateTone = (state) => state === "certified" ? "success" : state === "ready_for_review" ? "info" : state === "expired" ? "danger" : state === "needs_renewal" ? "warning" : "neutral";
const formatDate = (value) => value ? new Date(value).toLocaleDateString("en-MY", { day: "numeric", month: "short", year: "numeric" }) : "—";
const statusText = (value) => STATES[value] || String(value || "").replaceAll("_", " ");
const allOption = { value: "all", label: "All" };

export default function CrewGrowthAdminPage({ auth, ui, store, initialTab = "overview" }) {
  const [outlets, setOutlets] = useState([]);
  const [outletId, setOutletId] = useState("");
  const [data, setData] = useState({ skills: [], crew: [], reviews: [], recent_certifications: [] });
  const [evidence, setEvidence] = useState([]);
  const [loading, setLoading] = useState(true);
  const [skillEditor, setSkillEditor] = useState(null);
  const [employeeProfile, setEmployeeProfile] = useState(null);
  const [review, setReview] = useState(null);
  const canManage = auth.hasPermission("crew_growth.manage");
  const canAssess = auth.hasPermission("crew_growth.assess");
  const canCertify = auth.hasPermission("crew_growth.certify");

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const rows = store?.outlets?.length ? store.outlets : await outletService.listActiveOutlets();
        if (active) setOutlets((rows || []).filter((row) => row.is_active !== false));
      } catch (cause) { ui.notify({ title: "Unable to load Growth outlets", message: cause.message, tone: "error" }); setLoading(false); }
    })();
    return () => { active = false; };
  }, [store?.outlets, ui]);
  useEffect(() => { if (!outletId && outlets.length) setOutletId(outlets[0].id); }, [outletId, outlets]);

  async function refresh() {
    if (!outletId) return;
    setLoading(true);
    try {
      const growth = await crewService.growthAdminData(outletId);
      setData(growth);
      if (initialTab === "skills") {
        setEvidence(await crewService.growthAdminEvidence(outletId));
      } else {
        setEvidence([]);
      }
    } catch (cause) { ui.notify({ title: "Unable to load Crew Growth", message: cause.message, tone: "error" }); }
    finally { setLoading(false); }
  }
  useEffect(() => { refresh(); }, [initialTab, outletId]);

  async function saveSkill(payload) {
    try {
      await crewService.saveGrowthSkill({ ...payload, outlet_id: outletId });
      setSkillEditor(null); await refresh();
      ui.notify({ title: "Skill saved", message: "Applicability and certification requirements are now authoritative." });
    } catch (cause) { ui.notify({ title: "Unable to save skill", message: cause.message, tone: "error" }); throw cause; }
  }
  async function submitAssessment(values) {
    try {
      await crewService.submitGrowthAssessment(values); await refresh();
      setReview(null);
      ui.notify({ title: values.result === "pass" ? "Assessment passed" : "Improvement recorded", message: "Assessment history has been retained." });
    } catch (cause) { ui.notify({ title: "Unable to save assessment", message: cause.message, tone: "error" }); throw cause; }
  }
  async function certify(values) {
    try {
      await crewService.certifyGrowthSkill(values); setReview(null); await refresh();
      ui.notify({ title: "Crew skill certified", message: "A versioned certification history record was created." });
    } catch (cause) { ui.notify({ title: "Unable to certify skill", message: cause.message, tone: "error" }); throw cause; }
  }

  const outlet = outlets.find((item) => item.id === outletId);
  const header = tabMeta(initialTab);
  const outletSelect = <SelectField className="crew-growth-outlet" label="Outlet" ariaLabel="Growth outlet" value={outletId} onChange={setOutletId} options={outlets.map((item) => ({ value: item.id, label: item.name }))} />;
  return <div className="crew-growth-page">
    <PageHeader section="Crew · Growth" title={header.title} description={header.description} actions={<>{outletSelect}{initialTab === "skills" && canManage ? <button className="btn-primary" onClick={() => setSkillEditor({})}><Plus size={15} /> New Skill</button> : null}</>} />
    {loading ? <GrowthSkeleton /> : initialTab === "overview" ? <GrowthOverview data={data} onOpenReview={setReview} /> : initialTab === "skills" ? <SkillsLibrary data={data} canManage={canManage} onView={setSkillEditor} /> : initialTab === "crew" ? <CrewGrowth data={data} onView={setEmployeeProfile} /> : <CertificationQueue data={data} onReview={setReview} />}
    {skillEditor ? <SkillEditor skill={skillEditor} evidence={evidence} outlet={outlet} saving={loading} onClose={() => setSkillEditor(null)} onSave={saveSkill} /> : null}
    {employeeProfile ? <CrewGrowthProfile row={employeeProfile} onClose={() => setEmployeeProfile(null)} onReview={(item) => { setEmployeeProfile(null); setReview(item); }} /> : null}
    {review ? <CertificationReview item={review} canAssess={canAssess} canCertify={canCertify} onClose={() => setReview(null)} onAssess={submitAssessment} onCertify={certify} /> : null}
  </div>;
}

function tabMeta(tab) {
  if (tab === "skills") return { title: "Skills", description: "Define outlet and position-specific capabilities with server-derived certification requirements." };
  if (tab === "crew") return { title: "Crew Growth", description: "Review each Crew member’s durable capability profile and certification history." };
  if (tab === "reviews") return { title: "Certification Review", description: "Complete practical reviews only after authoritative learning evidence is ready." };
  return { title: "Growth Overview", description: "Team skill coverage, certification readiness and renewal attention in one view." };
}

function flattenStates(data) { return (data.crew || []).flatMap((row) => (row.skills || []).map((state) => ({ ...state, employee: row.employee, skill: data.skills.find((skill) => skill.id === state.skill_id) }))); }
function dataFor(employeeId, skillId, data) { return flattenStates(data).find((state) => state.employee_id === employeeId && state.skill_id === skillId); }

function GrowthOverview({ data, onOpenReview }) {
  const states = flattenStates(data).filter((row) => row.applicable);
  const activeCrew = data.crew.length;
  const certified = states.filter((row) => row.status === "certified").length;
  const pending = states.filter((row) => row.status === "ready_for_review").length;
  const attention = new Set(states.filter((row) => ["ready_for_review", "needs_renewal", "expired"].includes(row.status)).map((row) => row.employee_id)).size;
  return <div className="crew-growth-stack"><section className="crew-growth-metrics" aria-label="Growth metrics"><Metric icon={UsersRound} label="Active Crew" value={activeCrew} detail="In selected outlet" /><Metric icon={Award} label="Certified Skills" value={certified} detail="Current certifications" tone="success" /><Metric icon={ClipboardCheck} label="Certifications Pending" value={pending} detail="Ready for manager review" tone={pending ? "warning" : "neutral"} /><Metric icon={UserRoundCheck} label="Crew Need Attention" value={attention} detail="Review or renewal needed" tone={attention ? "danger" : "success"} /></section><div className="crew-growth-overview-grid"><div className="crew-growth-overview-column"><section className="crew-growth-section"><SectionHead title="Skill Coverage" detail="Certified active Crew by applicable skill" /><div className="crew-growth-coverage"><div className="crew-growth-coverage-head"><span>Skill</span><span>Certified</span><span>Coverage</span></div>{data.skills.filter((skill) => skill.status === "active").map((skill) => { const eligible = states.filter((row) => row.skill_id === skill.id); const count = eligible.filter((row) => row.status === "certified").length; const percent = eligible.length ? Math.round(count * 100 / eligible.length) : 0; return <article key={skill.id}><strong>{skill.name}</strong><span>{count} / {eligible.length}</span><div className="crew-growth-progress"><i style={{ width: `${percent}%` }} /><b>{percent}%</b></div></article>; })}{!data.skills.length ? <Empty title="No skills configured" detail="Create the first outlet skill in Skills." /> : null}</div></section><section className="crew-growth-section"><SectionHead title="Recent Certifications" detail="Immutable certification history" />{data.recent_certifications.length ? <DataTable density="compact" rows={data.recent_certifications.slice(0, 6)} getRowKey={(row) => row.id} tableClassName="min-w-[620px]" columns={[{ key: "employee", header: "Employee", render: (row) => <NameCell title={row.employee_name} /> }, { key: "skill", header: "Skill", render: (row) => row.skill_name }, { key: "date", header: "Certified Date", render: (row) => formatDate(row.certified_at) }, { key: "by", header: "Certified By", render: (row) => row.certified_by }]} /> : <Empty title="No certifications yet" detail="Completed certifications will form the permanent activity record." />}</section></div><div className="crew-growth-overview-column"><section className="crew-growth-section"><SectionHead title="Needs Attention" detail="Ready reviews and renewal risks" />{data.reviews.length ? <DataTable density="compact" rows={data.reviews.slice(0, 8)} getRowKey={(row) => `${row.employee_id}:${row.skill_id}`} onRowClick={onOpenReview} tableClassName="min-w-[620px]" columns={[{ key: "employee", header: "Employee", render: (row) => <NameCell title={row.employee_name} detail={row.position} /> }, { key: "skill", header: "Skill", render: (row) => row.skill_name }, { key: "issue", header: "Issue", render: (row) => <span className="crew-growth-issue">{attentionIssue(row.state.status)}</span> }, { key: "status", header: "Status", render: (row) => <StateBadge state={row.state.status} /> }, { key: "open", header: "", align: "right", render: () => <ChevronRight size={15} /> }]} /> : <Empty title="No Crew need attention" detail="Ready reviews and renewal risks will appear here." />}</section><StatusDistribution states={states} /></div></div></div>;
}

function StatusDistribution({ states }) {
  const rows = ["certified", "in_progress", "ready_for_review", "needs_renewal", "expired", "not_applicable"].map((state) => ({ state, count: states.filter((row) => row.status === state).length }));
  const total = Math.max(states.length, 1);
  return <section className="crew-growth-section"><SectionHead title="Certification Status" detail={`${states.length} applicable Crew skill records`} /><div className="crew-growth-status-distribution">{rows.map((row) => <div key={row.state}><StateBadge state={row.state} /><div className="crew-growth-status-bar"><i data-state={row.state} style={{ width: `${Math.round(row.count * 100 / total)}%` }} /></div><strong>{row.count}</strong><span>{Math.round(row.count * 100 / total)}%</span></div>)}</div></section>;
}

function SkillsLibrary({ data, canManage, onView }) {
  const [query, setQuery] = useState(""); const [category, setCategory] = useState("all"); const [position, setPosition] = useState("all"); const [status, setStatus] = useState("all");
  const positions = [...new Set(data.skills.flatMap((skill) => skill.positions || []))].sort();
  const rows = data.skills.filter((skill) => `${skill.name} ${skill.description || ""}`.toLowerCase().includes(query.toLowerCase()) && (category === "all" || skill.category === category) && (position === "all" || skill.positions.includes(position)) && (status === "all" || skill.status === status));
  const states = flattenStates(data);
  return <div className="crew-growth-stack"><FilterBar><SearchField label="Search" value={query} onChange={setQuery} placeholder="Search skills" /><SelectField label="Category" value={category} onChange={setCategory} options={[allOption, ...CATEGORIES.map((value) => ({ value, label: value }))]} /><SelectField label="Role / Position" value={position} onChange={setPosition} options={[allOption, ...positions.map((value) => ({ value, label: value }))]} /><SelectField label="Status" value={status} onChange={setStatus} options={[allOption, { value: "active", label: "Active" }, { value: "inactive", label: "Inactive" }]} /></FilterBar><section className="crew-growth-table"><DataTable rows={rows} getRowKey={(row) => row.id} onRowClick={onView} columns={[{ key: "skill", header: "Skill", render: (row) => <NameCell title={row.name} detail={row.description || "No description"} /> }, { key: "category", header: "Category" }, { key: "positions", header: "Applicable Roles", render: (row) => row.positions.length ? row.positions.join(", ") : "All active Crew" }, { key: "method", header: "Certification Method", render: (row) => methodLabel(row.certification_method) }, { key: "certified", header: "Certified Crew", render: (row) => { const eligible = states.filter((state) => state.skill_id === row.id && state.applicable); return `${eligible.filter((state) => state.status === "certified").length} / ${eligible.length}`; } }, { key: "status", header: "Status", render: (row) => <Badge tone={row.status === "active" ? "success" : "neutral"}>{row.status === "active" ? "Active" : "Inactive"}</Badge> }, { key: "actions", header: "Actions", align: "right", render: (row) => <button className="btn-secondary px-3 py-1.5 text-xs" onClick={() => onView(row)}>{canManage ? "View / Edit" : "View"}</button> }]} /></section></div>;
}

function CrewGrowth({ data, onView }) {
  const [query, setQuery] = useState(""); const [position, setPosition] = useState("all"); const [status, setStatus] = useState("all");
  const positions = [...new Set(data.crew.map((row) => row.employee.position).filter(Boolean))].sort();
  const rows = data.crew.map((row) => ({ ...row, skills: row.skills.map((state) => ({ ...state, skill: data.skills.find((skill) => skill.id === state.skill_id) })), summary: summarize(row.skills) })).filter((row) => `${row.employee.full_name} ${row.employee.employee_code || ""}`.toLowerCase().includes(query.toLowerCase()) && (position === "all" || row.employee.position === position) && (status === "all" || growthStatus(row.summary) === status));
  return <div className="crew-growth-stack"><FilterBar><SearchField label="Search Crew" value={query} onChange={setQuery} placeholder="Search Crew" /><SelectField label="Position" value={position} onChange={setPosition} options={[allOption, ...positions.map((value) => ({ value, label: value }))]} /><SelectField label="Growth Status" value={status} onChange={setStatus} options={[allOption, { value: "on_track", label: "On Track" }, { value: "attention", label: "Needs Attention" }, { value: "not_started", label: "Not Started" }]} /></FilterBar><section className="crew-growth-table"><DataTable rows={rows} getRowKey={(row) => row.employee.id} onRowClick={onView} columns={[{ key: "employee", header: "Employee", render: (row) => <NameCell title={row.employee.full_name} detail={row.employee.employee_code || row.employee.position} /> }, { key: "position", header: "Position", render: (row) => row.employee.position || "—" }, { key: "certified", header: "Certified Skills", render: (row) => row.summary.certified }, { key: "progress", header: "In Progress", render: (row) => row.summary.inProgress }, { key: "ready", header: "Ready for Review", render: (row) => row.summary.ready }, { key: "last", header: "Last Certification", render: (row) => formatDate(latestCertification(row.skills)) }, { key: "status", header: "Growth Status", render: (row) => <Badge tone={growthStatus(row.summary) === "attention" ? "warning" : growthStatus(row.summary) === "on_track" ? "success" : "neutral"}>{growthStatus(row.summary) === "attention" ? "Needs Attention" : growthStatus(row.summary) === "on_track" ? "On Track" : "Not Started"}</Badge> }, { key: "open", header: "", align: "right", render: () => <ChevronRight size={16} /> }]} /></section></div>;
}

function CertificationQueue({ data, onReview }) {
  const [skillId, setSkillId] = useState("all"); const [employee, setEmployee] = useState("all"); const [status, setStatus] = useState("all");
  const rows = data.reviews.filter((row) => (skillId === "all" || row.skill_id === skillId) && (employee === "all" || row.employee_id === employee) && (status === "all" || row.state.status === status));
  return <div className="crew-growth-stack"><FilterBar><SelectField label="Skill" value={skillId} onChange={setSkillId} options={[allOption, ...data.skills.map((row) => ({ value: row.id, label: row.name }))]} /><SelectField label="Employee" value={employee} onChange={setEmployee} options={[allOption, ...data.crew.map((row) => ({ value: row.employee.id, label: row.employee.full_name }))]} /><SelectField label="Status" value={status} onChange={setStatus} options={[allOption, { value: "ready_for_review", label: "Ready for Review" }, { value: "needs_renewal", label: "Needs Renewal" }, { value: "expired", label: "Expired" }]} /></FilterBar><section className="crew-growth-table">{rows.length ? <DataTable rows={rows} getRowKey={(row) => `${row.employee_id}:${row.skill_id}`} columns={[{ key: "employee", header: "Employee", render: (row) => <NameCell title={row.employee_name} detail={row.position} /> }, { key: "skill", header: "Skill", render: (row) => row.skill_name }, { key: "learning", header: "Learning Requirements", render: (row) => `${row.state.requirements_completed} / ${row.state.requirements_total} complete` }, { key: "practical", header: "Practical Review", render: (row) => row.state.requirements.some((item) => item.type === "practical" && item.completed) ? "Passed" : "Pending" }, { key: "ready", header: "Status", render: (row) => <StateBadge state={row.state.status} /> }, { key: "action", header: "Action", align: "right", render: (row) => <button className="btn-primary px-3 py-1.5 text-xs" onClick={() => onReview(row)}>Review</button> }]} /> : <Empty title="Certification queue is clear" detail="Crew appear after their learning evidence reaches review state." />}</section></div>;
}

function SkillEditor({ skill, evidence, outlet, saving, onClose, onSave }) {
  const [form, setForm] = useState(() => ({ id: skill.id || "", name: skill.name || "", category: skill.category || "Service", description: skill.description || "", status: skill.status || "active", certification_method: skill.certification_method || "learning_and_review", validity_months: skill.validity_months || "", positions: skill.positions || [], outlets: skill.outlets?.length ? skill.outlets : outlet?.id ? [outlet.id] : [], requirements: skill.requirements || [] }));
  const [positionText, setPositionText] = useState((form.positions || []).join(", "));
  const set = (patch) => setForm((current) => ({ ...current, ...patch }));
  const addRequirement = () => set({ requirements: [...form.requirements, { type: "module", reference_id: "", label: "", required: true, config: {} }] });
  const changeRequirement = (index, patch) => set({ requirements: form.requirements.map((row, i) => i === index ? { ...row, ...patch } : row) });
  const submit = () => onSave({ ...form, positions: positionText.split(",").map((value) => value.trim()).filter(Boolean), requirements: form.requirements.map((row) => ({ ...row, label: row.label || evidence.find((item) => item.id === row.reference_id)?.label || requirementLabel(row.type) })) });
  return <Modal title={skill.id ? "Edit Skill" : "New Skill"} description={`${outlet?.name || "Outlet"} · Versioned certification requirements`} size="2xl" onClose={onClose} bodyClassName="crew-growth-skill-editor" footer={<><button className="btn-secondary" onClick={onClose}>Cancel</button><button className="btn-primary" disabled={saving || !form.name.trim()} onClick={submit}>{saving ? "Saving…" : "Save Skill"}</button></>}><div className="crew-growth-form-grid"><label>Skill Name<input className="control" value={form.name} onChange={(event) => set({ name: event.target.value })} /></label><label>Category<input className="control" list="growth-categories" value={form.category} onChange={(event) => set({ category: event.target.value })} /><datalist id="growth-categories">{CATEGORIES.map((value) => <option key={value}>{value}</option>)}</datalist></label><label className="is-wide">Description<textarea className="control" value={form.description} onChange={(event) => set({ description: event.target.value })} /></label><label>Applicable Positions<input className="control" value={positionText} onChange={(event) => setPositionText(event.target.value)} placeholder="Service Crew, Cashier" /><small>Comma separated. Leave empty for all active Crew.</small></label><SelectField label="Status" value={form.status} onChange={(status) => set({ status })} options={[{ value: "active", label: "Active" }, { value: "inactive", label: "Inactive" }]} /><SelectField label="Certification Method" value={form.certification_method} onChange={(certification_method) => set({ certification_method })} options={[{ value: "learning", label: "Learning" }, { value: "learning_and_review", label: "Learning + Manager Review" }, { value: "manager_review", label: "Manager Review" }, { value: "manual", label: "Manual Certification" }]} /><label>Certification Validity<input className="control" type="number" min="1" max="120" value={form.validity_months} onChange={(event) => set({ validity_months: event.target.value })} placeholder="No Expiry" /><small>Months; blank means no expiry.</small></label></div><section className="crew-growth-requirements-editor"><header><div><h3>Certification Requirements</h3><p>Every required item is evaluated by the server.</p></div><button className="btn-secondary" onClick={addRequirement}><Plus size={14} /> Add Requirement</button></header>{form.requirements.map((row, index) => <article key={`${row.id || "new"}:${index}`}><SelectField label="Requirement" value={row.type} onChange={(type) => changeRequirement(index, { type, reference_id: "", label: requirementLabel(type) })} options={[{ value: "module", label: "Complete Onboarding Module" }, { value: "lesson", label: "Complete Specific Lesson" }, { value: "sop", label: "Read / Acknowledge SOP" }, { value: "quiz", label: "Pass Knowledge Check" }, { value: "practical", label: "Manager Practical Assessment" }, { value: "performance", label: "Performance Threshold (Reserved)" }, { value: "manual", label: "Manual Certification" }]} />{["module", "lesson", "sop", "quiz"].includes(row.type) ? <SelectField searchable label="Evidence" value={row.reference_id || ""} onChange={(reference_id) => changeRequirement(index, { reference_id, label: evidence.find((item) => item.id === reference_id)?.label || "" })} options={evidence.filter((item) => item.type === row.type).map((item) => ({ value: item.id, label: item.label }))} placeholder="Select published evidence" /> : <label>Requirement Label<input className="control" value={row.label || ""} onChange={(event) => changeRequirement(index, { label: event.target.value })} /></label>}<label className="crew-growth-required"><input type="checkbox" checked={row.required !== false} onChange={(event) => changeRequirement(index, { required: event.target.checked })} /> Required</label><button className="icon-btn is-danger" aria-label={`Delete requirement ${index + 1}`} onClick={() => set({ requirements: form.requirements.filter((_, i) => i !== index) })}>×</button></article>)}{!form.requirements.length ? <Empty title="No requirements yet" detail="Add learning, SOP, quiz, practical or manual evidence." /> : null}</section></Modal>;
}

function CrewGrowthProfile({ row, onClose, onReview }) {
  const summary = summarize(row.skills);
  return <Modal title="Crew Growth Profile" description="Durable skill progress and certification history" size="xl" onClose={onClose} footer={<button className="btn-secondary" onClick={onClose}>Close</button>} panelClassName="crew-growth-profile-modal"><div className="crew-growth-profile"><section className="crew-growth-profile-identity"><InitialAvatar name={row.employee.full_name} size="lg" /><div><h3>{row.employee.full_name}</h3><p>{row.employee.position || "Crew"}</p><span>{row.employee.employee_code || "Active Crew"}</span></div><Badge tone="success">Active</Badge></section><section className="crew-growth-profile-summary"><Metric icon={null} label="Certified" value={summary.certified} /><Metric icon={null} label="In Progress" value={summary.inProgress} /><Metric icon={null} label="Ready for Review" value={summary.ready} /><Metric icon={null} label="Not Started" value={row.skills.filter((state) => state.status === "not_started").length} /></section><div className="crew-growth-profile-list"><header><strong>Skill Progress</strong><span>{row.skills.length} skills</span></header>{row.skills.map((state) => <button key={state.skill_id} onClick={() => onReview({ employee_id: row.employee.id, employee_name: row.employee.full_name, position: row.employee.position, skill_id: state.skill_id, skill_name: state.skill?.name || "Skill", state })}><span><strong>{state.skill?.name || "Skill"}</strong><small>{state.status === "certified" ? `Certified ${formatDate(state.certification?.certified_at)}` : `${state.requirements_completed} / ${state.requirements_total} requirements complete`}</small></span><div className="crew-growth-skill-row-progress"><i style={{ width: `${state.requirements_total ? Math.round(state.requirements_completed * 100 / state.requirements_total) : 0}%` }} /></div><StateBadge state={state.status} /><ChevronRight size={15} /></button>)}</div></div></Modal>;
}

function CertificationReview({ item, canAssess, canCertify, onClose, onAssess, onCertify }) {
  const [checklist, setChecklist] = useState(() => practicalItems(item).map((label) => ({ label, rating: "meets_standard" })));
  const [note, setNote] = useState(""); const [saving, setSaving] = useState(false);
  const passPractical = checklist.every((row) => row.rating === "meets_standard");
  const assess = async () => { setSaving(true); try { await onAssess({ employeeId: item.employee_id, skillId: item.skill_id, result: passPractical ? "pass" : "needs_improvement", checklist, note }); } finally { setSaving(false); } };
  const certify = async () => { setSaving(true); try { await onCertify({ employeeId: item.employee_id, skillId: item.skill_id, note }); } finally { setSaving(false); } };
  const state = item.state;
  return <Modal title="Practical Assessment" description={`${item.skill_name} · ${item.employee_name}`} size="2xl" onClose={onClose} panelClassName="crew-growth-assessment-modal" footer={<><button className="btn-secondary" onClick={onClose}>Cancel</button>{canAssess && state.requirements.some((row) => row.type === "practical") ? <button className="btn-primary" disabled={saving} onClick={assess}>{passPractical ? "Submit Assessment" : "Record Improvement"}</button> : null}{canCertify ? <button className="btn-secondary" disabled={saving || !eligibleToCertify(state)} onClick={certify}>Certify Skill</button> : null}</>}><div className="crew-growth-review"><header><div><NameCell title={item.employee_name} detail={item.position || "Crew"} /><span>{state.requirements_completed} / {state.requirements_total} requirements complete</span></div><StateBadge state={state.status} /></header><div className="crew-growth-review-grid"><section className="crew-growth-evidence-panel"><h3>Requirements Checklist</h3>{state.requirements.map((row) => <article key={row.requirement_id}><span className={row.completed ? "is-done" : ""}>{row.completed ? "✓" : "○"}</span><div><strong>{row.label}</strong><small>{row.detail}</small></div>{row.score != null ? <Badge tone="info">{row.score}%</Badge> : <StateBadge state={row.completed ? "certified" : row.type === "practical" ? "ready_for_review" : "not_started"} />}</article>)}</section>{state.requirements.some((row) => row.type === "practical") ? <section className="crew-growth-practical-panel"><div className="crew-growth-assessment-head"><div><h3>Assessment Checklist</h3><p>Observe the Crew member during actual work.</p></div><div className={`crew-growth-result is-${passPractical ? "pass" : "improve"}`}><strong>{passPractical ? "Pass" : "Needs Improvement"}</strong><span>{passPractical ? "Meets the standard" : "Further coaching required"}</span></div></div>{checklist.map((row, index) => <div className="crew-growth-assessment-row" key={row.label}><strong>{row.label}</strong><div className="crew-growth-rating" role="group" aria-label={`${row.label} rating`}>{[{ value: "meets_standard", label: "Meets Standard" }, { value: "needs_improvement", label: "Needs Improvement" }, { value: "not_observed", label: "Not Observed" }].map((option) => <button key={option.value} className={row.rating === option.value ? "is-active" : ""} type="button" aria-pressed={row.rating === option.value} onClick={() => setChecklist((current) => current.map((entry, i) => i === index ? { ...entry, rating: option.value } : entry))}>{option.label}</button>)}</div></div>)}<label>Manager Note<textarea className="control" value={note} onChange={(event) => setNote(event.target.value)} placeholder="Optional assessment or certification note" /></label></section> : null}</div></div></Modal>;
}

function practicalItems(item) { const configured = item.state.requirements.find((row) => row.type === "practical")?.config?.items; return configured?.length ? configured : ["Demonstrates the standard consistently", "Uses the correct sequence", "Works safely and independently"]; }
function eligibleToCertify(state) { return state.applicable && state.requirements.every((row) => !row.required || ["manual", "performance"].includes(row.type) || row.completed); }
function requirementLabel(type) { return ({ module: "Complete Onboarding Module", lesson: "Complete Specific Lesson", sop: "Read / Acknowledge SOP", quiz: "Pass Knowledge Check", practical: "Manager Practical Assessment", performance: "Minimum Performance Threshold", manual: "Manual Certification" })[type] || "Requirement"; }
function methodLabel(value) { return ({ learning: "Learning", learning_and_review: "Learning + Manager Review", manager_review: "Manager Review", manual: "Manual Certification" })[value] || value; }
function attentionIssue(state) { return state === "ready_for_review" ? "Assessment pending" : state === "needs_renewal" ? "Certification renewal due" : "Certification expired"; }
function summarize(skills = []) { return { certified: skills.filter((row) => row.status === "certified").length, inProgress: skills.filter((row) => row.status === "in_progress").length, ready: skills.filter((row) => row.status === "ready_for_review").length, attention: skills.filter((row) => ["ready_for_review", "needs_renewal", "expired"].includes(row.status)).length }; }
function growthStatus(summary) { return summary.attention ? "attention" : summary.certified || summary.inProgress ? "on_track" : "not_started"; }
function latestCertification(skills = []) { return skills.map((row) => row.certification?.certified_at).filter(Boolean).sort().at(-1); }
function StateBadge({ state }) { return <Badge tone={stateTone(state)}>{statusText(state)}</Badge>; }
function InitialAvatar({ name, size = "sm" }) { const initials = String(name || "Crew").split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase(); return <span className={`crew-growth-avatar is-${size}`} aria-hidden="true">{initials}</span>; }
function NameCell({ title, detail }) { return <span className="crew-growth-name"><InitialAvatar name={title} /><span><strong>{title}</strong><small>{detail || "—"}</small></span></span>; }
function Metric({ icon: Icon = Sparkles, label, value, detail, tone = "neutral" }) { return <article className={`crew-growth-metric is-${tone}`}><div className="crew-growth-metric-icon">{Icon ? <Icon size={16} /> : null}</div><span><small>{label}</small><strong>{value}</strong>{detail ? <em>{detail}</em> : null}</span></article>; }
function SectionHead({ title, detail }) { return <header className="crew-growth-section-head"><div><h2>{title}</h2><p>{detail}</p></div></header>; }
function FilterBar({ children }) { return <section className="crew-growth-filterbar">{children}</section>; }
function SearchField({ label, value, onChange, placeholder }) { return <label className="crew-growth-search"><span>{label}</span><div><Search size={15} /><input value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} /></div></label>; }
function Empty({ title, detail }) { return <div className="crew-growth-empty"><ShieldCheck size={22} /><strong>{title}</strong><span>{detail}</span></div>; }
function GrowthSkeleton() { return <div className="crew-growth-skeleton"><span /><span /><span /><p>Loading Growth…</p></div>; }
