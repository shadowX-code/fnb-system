import { useMemo, useState } from "react";
import {
  ArrowLeft,
  Award,
  BadgeCheck,
  BookOpenCheck,
  CheckCircle2,
  ChevronRight,
  Circle,
  Clock3,
  Search,
  Sparkles,
  Target,
} from "lucide-react";
import { CrewMetric, CrewSectionHeader, CrewStatusBadge } from "./CrewMobileUI.jsx";

const statusCopy = {
  certified: "Certified",
  in_progress: "In Progress",
  ready_for_review: "Ready for Review",
  not_started: "Not Started",
  needs_renewal: "Ready for Review",
  expired: "Expired",
};

const statusClass = (status) => `is-${String(status || "not_started").replaceAll("_", "-")}`;
const percentFor = (skill) => {
  const total = Number(skill?.requirements_total) || 0;
  return total ? Math.round(((Number(skill?.requirements_completed) || 0) / total) * 100) : 0;
};
const formatDate = (value) => value
  ? new Date(value).toLocaleDateString("en-MY", { day: "numeric", month: "short", year: "numeric" })
  : "—";

function ProgressBar({ value }) {
  return <div className="crew-v2-progress" aria-label={`${value}% complete`}><span style={{ width: `${value}%` }} /></div>;
}

function PageHeader({ title, onBack, action }) {
  return <header className="crew-v2-page-header">
    <div>{onBack && <button type="button" onClick={onBack} aria-label="Back"><ArrowLeft size={19} /></button>}<h1>{title}</h1></div>
    {action}
  </header>;
}

export default function CrewGrowthMobile({ data, performance, loading, error, onRetry }) {
  const [view, setView] = useState("overview");
  const [selectedSkill, setSelectedSkill] = useState(null);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("All");
  const skills = data?.skills || [];
  const summary = data?.summary || { certified: 0, in_progress: 0, ready_for_review: 0, not_started: 0, total: 0 };
  const categories = useMemo(() => ["All", ...new Set(skills.map((skill) => skill.category).filter(Boolean))], [skills]);
  const filtered = useMemo(() => skills.filter((skill) => {
    const matchesQuery = !query || `${skill.name} ${skill.category}`.toLowerCase().includes(query.toLowerCase());
    return matchesQuery && (category === "All" || skill.category === category);
  }), [skills, query, category]);
  const completeRequirements = skills.reduce((sum, skill) => sum + (Number(skill.requirements_completed) || 0), 0);
  const allRequirements = skills.reduce((sum, skill) => sum + (Number(skill.requirements_total) || 0), 0);
  const overall = allRequirements ? Math.round((completeRequirements / allRequirements) * 100) : 0;
  const nextMilestone = skills.find((skill) => skill.status === "ready_for_review") || skills.find((skill) => skill.status === "in_progress") || skills.find((skill) => skill.status === "not_started");

  function openSkill(skill) {
    setSelectedSkill(skill);
    setView("skill");
  }

  if (loading) return <section className="crew-v2-state"><span className="crew-v2-spinner" /><strong>Loading your growth…</strong></section>;
  if (error) return <section className="crew-v2-state is-error"><Target size={24} /><strong>Growth is unavailable</strong><p>{error}</p><button type="button" onClick={onRetry}>Try again</button></section>;

  if (view === "skill" && selectedSkill) {
    const progress = percentFor(selectedSkill);
    return <section className="crew-v2-growth">
      <PageHeader title="Skill Detail" onBack={() => { setView("skills"); setSelectedSkill(null); }} />
      <article className="crew-v2-skill-hero">
        <div className="crew-v2-icon-token"><BadgeCheck size={23} /></div>
        <div><h2>{selectedSkill.name}</h2><p>{selectedSkill.category}</p></div>
        <CrewStatusBadge tone={selectedSkill.status === "certified" ? "success" : selectedSkill.status === "ready_for_review" ? "ready" : "neutral"}>{statusCopy[selectedSkill.status] || selectedSkill.status}</CrewStatusBadge>
      </article>
      {selectedSkill.description && <p className="crew-v2-skill-description">{selectedSkill.description}</p>}
      <section className="crew-v2-section-block">
        <div className="crew-v2-section-title"><h2>My progress</h2><strong>{selectedSkill.requirements_completed} / {selectedSkill.requirements_total}</strong></div>
        <ProgressBar value={progress} />
        <div className="crew-v2-requirements">
          {(selectedSkill.requirements || []).map((requirement) => <div key={requirement.requirement_id}>
            {requirement.completed ? <CheckCircle2 size={18} /> : <Circle size={18} />}
            <span><strong>{requirement.label}</strong><small>{requirement.detail}</small></span>
            <em>{requirement.completed ? "Completed" : requirement.type === "practical" ? "Manager review" : "Pending"}</em>
          </div>)}
        </div>
      </section>
      {selectedSkill.certification && <section className="crew-v2-certificate-note"><Award size={20} /><div><strong>Certified {formatDate(selectedSkill.certification.certified_at)}</strong><small>{selectedSkill.certification.expires_at ? `Valid until ${formatDate(selectedSkill.certification.expires_at)}` : "No expiry"}</small></div></section>}
    </section>;
  }

  if (view === "skills") return <section className="crew-v2-growth">
    <PageHeader title="Skills" onBack={() => setView("overview")} />
    <label className="crew-v2-search"><Search size={17} /><input aria-label="Search skills" placeholder="Search skills" value={query} onChange={(event) => setQuery(event.target.value)} /></label>
    <div className="crew-v2-chips" aria-label="Skill categories">{categories.map((item) => <button type="button" key={item} className={category === item ? "active" : ""} onClick={() => setCategory(item)}>{item}</button>)}</div>
    {[['Ready for Review', filtered.filter((skill) => ['ready_for_review', 'needs_renewal'].includes(skill.status))], ['In Progress', filtered.filter((skill) => skill.status === 'in_progress')], ['Certified', filtered.filter((skill) => skill.status === 'certified')], ['Not Started', filtered.filter((skill) => skill.status === 'not_started')]].filter(([, rows]) => rows.length).map(([label, rows]) => <section className="crew-v3-skill-group" key={label}><CrewSectionHeader title={`${label} · ${rows.length}`} /><div className="crew-v2-skill-list">{rows.map((skill) => <button type="button" key={skill.id} onClick={() => openSkill(skill)}>
      <div className="crew-v2-row-icon"><BookOpenCheck size={17} /></div>
      <span><strong>{skill.name}</strong><small>{skill.category}{skill.status === 'ready_for_review' ? ' · Learning requirements complete' : ''}</small>{skill.status === "in_progress" && <ProgressBar value={percentFor(skill)} />}</span>
      <em className={`crew-v2-status ${statusClass(skill.status)}`}>{statusCopy[skill.status] || skill.status}</em>
      <ChevronRight size={16} />
    </button>)}</div></section>)}
    {!filtered.length && <div className="crew-v2-empty">No skills match this filter.</div>}
  </section>;

  if (view === "path") {
    const next = skills.find((skill) => skill.status === "ready_for_review") || skills.find((skill) => skill.status === "in_progress") || skills.find((skill) => skill.status === "not_started");
    return <section className="crew-v2-growth">
      <PageHeader title="My Path" onBack={() => setView("overview")} />
      <article className="crew-v2-path-hero"><Sparkles size={23} /><p>Keep going!</p><h2>{next ? next.name : "Your next milestone"}</h2><ProgressBar value={next ? percentFor(next) : overall} /><small>{next ? `${next.requirements_completed} of ${next.requirements_total} requirements complete` : "All current milestones complete"}</small></article>
      <section className="crew-v2-section-block"><div className="crew-v2-section-title"><h2>Growth timeline</h2><span>{data?.timeline?.length || 0} updates</span></div>
        <div className="crew-v2-timeline">{(data?.timeline || []).map((event, index) => <div key={`${event.type}-${event.occurred_at}-${index}`}><span><CheckCircle2 size={15} /></span><div><strong>{event.label}</strong><small>{event.skill_name} · {formatDate(event.occurred_at)}{event.score != null ? ` · ${event.score}%` : ""}</small></div></div>)}</div>
        {!data?.timeline?.length && <div className="crew-v2-empty">Your completed learning and certifications will appear here.</div>}
      </section>
    </section>;
  }

  if (view === "certifications") {
    const groups = [
      ["Ready for Review", skills.filter((skill) => ["ready_for_review", "needs_renewal"].includes(skill.status))],
      ["In Progress", skills.filter((skill) => skill.status === "in_progress")],
      ["Completed", skills.filter((skill) => skill.status === "certified")],
    ];
    return <section className="crew-v2-growth">
      <PageHeader title="My Certifications" onBack={() => setView("overview")} />
      {groups.map(([label, rows]) => <section className="crew-v2-cert-group" key={label}><div className="crew-v2-section-title"><h2>{label}</h2><span>{rows.length}</span></div>
        {rows.length ? <div className="crew-v2-skill-list">{rows.map((skill) => <button type="button" key={skill.id} onClick={() => openSkill(skill)}><div className="crew-v2-row-icon"><Award size={17} /></div><span><strong>{skill.name}</strong><small>{skill.status === "certified" ? `Certified ${formatDate(skill.certification?.certified_at)}` : `${skill.requirements_completed} / ${skill.requirements_total} requirements`}</small></span><ChevronRight size={16} /></button>)}</div> : <p className="crew-v2-group-empty">No skills in this stage.</p>}
      </section>)}
    </section>;
  }

  if (view === "performance") {
    const breakdown = [
      ["attendance", "Attendance", 30], ["service", "Service Standards", 30], ["customer", "Customer Experience", 15],
      ["knowledge", "Knowledge & SOP", 15], ["conduct", "Conduct", 10],
    ];
    return <section className="crew-v2-growth crew-v2-performance">
      <PageHeader title="My Performance" onBack={() => setView("overview")} />
      {!performance ? <section className="crew-v2-performance-empty"><Target size={28} /><h2>Performance is not available yet</h2><p>Your monthly score will appear after the outlet has enough verified evidence.</p></section> : <>
        <article className="crew-v2-performance-hero"><small>{new Date(performance.period_start).toLocaleDateString("en-MY", { month: "long", year: "numeric" })}</small><div><strong>{performance.score == null ? "—" : Math.round(performance.score)}</strong><span>out of 100</span></div><h2>{performance.score == null ? "Review in progress" : performance.score >= 85 ? "Great work!" : performance.score >= 70 ? "Good progress" : "Keep improving"}</h2><p>{performance.status === "finalized" ? "Finalized monthly result" : "Evidence is still being reviewed"}</p></article>
        <section className="crew-v2-section-block"><div className="crew-v2-section-title"><h2>Score breakdown</h2><span>{performance.calculation_version}</span></div><div className="crew-v2-performance-list">{breakdown.map(([key, label, max]) => { const item = performance.breakdown?.[key] || {}; const value = item.score; return <details key={key}><summary><span><strong>{label}</strong><small>{item.confidence ? `${String(item.confidence).replaceAll("_", " ")} confidence` : item.status === "review_required" ? "Manager review required" : "Evidence based"}</small></span><b>{value == null ? "—" : Math.round(value)} / {max}</b></summary><div className="crew-v2-performance-meter"><i style={{ width: `${value == null ? 0 : Math.min(100, Number(value) * 100 / max)}%` }} /></div><p>{item.explanation || "This component is calculated from verified FeedX evidence."}</p></details>; })}</div></section>
        <section className="crew-v2-section-block"><div className="crew-v2-section-title"><h2>Recent months</h2></div><div className="crew-v2-performance-trend">{(performance.trend || []).map((item) => <span key={item.period_start}><small>{new Date(item.period_start).toLocaleDateString("en-MY", { month: "short" })}</small><strong>{item.score == null ? "—" : Math.round(item.score)}</strong></span>)}</div></section>
      </>}
    </section>;
  }

  return <section className="crew-v2-growth">
    <PageHeader title="Growth" />
    <nav className="crew-v2-growth-tabs" aria-label="Growth sections">
      <button type="button" className="active">Overview</button>
      <button type="button" onClick={() => setView("skills")}>Skills</button>
      <button type="button" onClick={() => setView("path")}>My Path</button>
    </nav>
    <article className="crew-v3-milestone-hero"><span><small>Next Milestone</small><h2>{nextMilestone?.name || "Keep growing"}</h2><p>{nextMilestone?.category || "Your learning path"}</p>{nextMilestone && <CrewStatusBadge tone={nextMilestone.status === "ready_for_review" ? "ready" : "neutral"}>{statusCopy[nextMilestone.status]}</CrewStatusBadge>}</span><Target size={54} /><button type="button" onClick={() => nextMilestone ? openSkill(nextMilestone) : setView("path")}>View skill <ChevronRight size={16} /></button></article>
    <section className="crew-v2-section-block"><CrewSectionHeader title="My Progress" action="View skills" onAction={() => setView("skills")} /><div className="crew-v2-growth-stats">
      <CrewMetric value={summary.certified || 0} label="Certified" tone="success" onClick={() => setView("certifications")} />
      <CrewMetric value={summary.in_progress || 0} label="In Progress" tone="blue" onClick={() => setView("skills")} />
      <CrewMetric value={summary.ready_for_review || 0} label="Ready" tone="amber" onClick={() => setView("certifications")} />
      <CrewMetric value={summary.not_started || 0} label="Not Started" onClick={() => setView("skills")} />
    </div></section>
    <div className="crew-v2-growth-links">
      <button type="button" onClick={() => setView("skills")}><BookOpenCheck size={18} /><span><strong>Skills</strong><small>See requirements and evidence</small></span><ChevronRight size={17} /></button>
      <button type="button" onClick={() => setView("path")}><Target size={18} /><span><strong>My Path</strong><small>Your next milestone and history</small></span><ChevronRight size={17} /></button>
      <button type="button" onClick={() => setView("certifications")}><Award size={18} /><span><strong>My Certifications</strong><small>Ready, in progress and completed</small></span><ChevronRight size={17} /></button>
      <button type="button" onClick={() => setView("performance")}><Sparkles size={18} /><span><strong>Performance</strong><small>{performance ? "View your monthly score" : "Evidence in progress"}</small></span><ChevronRight size={17} /></button>
    </div>
    {performance && <button type="button" className="crew-v3-performance-preview" onClick={() => setView("performance")}><span><small>Performance</small><strong>{Math.round(performance.score)}</strong><em>{performance.trend?.length > 1 ? "Recent monthly result" : "This month"}</em></span><span>View Breakdown <ChevronRight size={16} /></span></button>}
  </section>;
}
