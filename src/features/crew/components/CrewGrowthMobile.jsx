import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  Award,
  BadgeCheck,
  BookOpenCheck,
  CheckCircle2,
  ChevronRight,
  Circle,
  CircleHelp,
  Clock3,
  Search,
  Sparkles,
  Star,
  Target,
  X,
} from "lucide-react";
import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import milestoneArtwork from "../../../assets/crew/growth-milestone-target.png";
import { CrewSectionHeader, CrewStatusBadge } from "./CrewMobileUI.jsx";

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

function GrowthHelpModal({ onClose }) {
  const modalRef = useRef(null);
  const closeRef = useRef(null);
  useEffect(() => {
    const previousFocus = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();
    const handleKeyDown = (event) => {
      if (event.key === "Escape") return onClose();
      if (event.key !== "Tab") return;
      const focusable = [...modalRef.current.querySelectorAll("button, [href], [tabindex]:not([tabindex='-1'])")];
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", handleKeyDown);
      previousFocus?.focus?.();
    };
  }, [onClose]);
  return <div className="crew-growth-final-modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
    <section ref={modalRef} className="crew-growth-final-modal" role="dialog" aria-modal="true" aria-label="About Growth" onMouseDown={(event) => event.stopPropagation()}>
      <header><h2>About Growth</h2><button ref={closeRef} type="button" aria-label="Close Growth help" onClick={onClose}><X size={19} /></button></header>
      <div>
        <section><strong>Skills</strong><p>Track the operational skills you are working toward.</p></section>
        <section><strong>Ready for Review</strong><p>You have completed the required evidence and are waiting for manager review.</p></section>
        <section><strong>Performance</strong><p>Your monthly performance score reflects your verified work evidence.</p></section>
      </div>
    </section>
  </div>;
}

const performanceLevel = (score) => {
  if (score == null || Number.isNaN(Number(score))) return "Awaiting data";
  if (score >= 95) return "Outstanding";
  if (score >= 90) return "Excellent";
  if (score >= 85) return "Strong";
  if (score >= 80) return "Good";
  if (score >= 75) return "Meets Standard";
  if (score >= 70) return "Developing";
  return "Below Standard";
};

function GrowthMilestoneHero({ skill, onOpen }) {
  return <article className="crew-growth-final-hero">
    <img src={milestoneArtwork} alt="" />
    <div className="crew-growth-final-hero-copy">
      <small>Next Milestone</small>
      <h2>{skill?.name || "All caught up"}</h2>
      <p>{skill?.category || "Your current skills are up to date."}</p>
      {skill ? <><CrewStatusBadge tone={skill.status === "ready_for_review" ? "ready" : "neutral"}>{statusCopy[skill.status] || skill.status}</CrewStatusBadge><button type="button" onClick={() => onOpen(skill)}>View skill <ChevronRight size={17} /></button></> : null}
    </div>
  </article>;
}

const skillSummaryCards = [
  { key: "certified", label: "Certified", icon: BadgeCheck, tone: "green" },
  { key: "in_progress", label: "In Progress", icon: Circle, tone: "blue" },
  { key: "ready_for_review", label: "Ready for Review", icon: Star, tone: "amber" },
  { key: "not_started", label: "Not Started", icon: Clock3, tone: "neutral" },
];

function GrowthSkillSummary({ summary, onViewAll }) {
  return <section className="crew-growth-final-skills">
    <header><span><h2>Your Skills</h2><p>Track your skills and certification progress.</p></span><button type="button" onClick={onViewAll}>View all skills <ChevronRight size={17} /></button></header>
    <div className="crew-growth-final-stat-grid">
      {skillSummaryCards.map(({ key, label, icon: Icon, tone }) => <article key={key} className={`is-${tone}`}><Icon size={25} /><strong>{summary?.[key] || 0}</strong><span>{label}</span></article>)}
    </div>
  </section>;
}

function GrowthReadyList({ skills, onOpen, onViewAll }) {
  if (!skills.length) return null;
  return <section className="crew-growth-final-ready">
    <header><h3>Ready for Review</h3><span>{skills.length} {skills.length === 1 ? "skill" : "skills"}</span></header>
    <div>{skills.slice(0, 3).map((skill) => <button type="button" key={skill.id} onClick={() => onOpen(skill)}><i><BookOpenCheck size={20} /></i><span><strong>{skill.name}</strong><small>{skill.category || "Operational Skill"}</small></span><em>Ready for Review</em><ChevronRight size={18} /></button>)}</div>
    <button type="button" className="crew-growth-final-view-all" onClick={onViewAll}>View all skills <ChevronRight size={18} /></button>
  </section>;
}

function GrowthPerformanceCard({ performance, onOpen }) {
  const score = performance?.score == null ? null : Math.round(Number(performance.score));
  const trend = (performance?.trend || []).filter((item) => item.score != null).slice(-6).map((item) => ({ ...item, score: Number(item.score), label: new Date(`${item.period_start}T00:00:00`).toLocaleDateString("en-MY", { month: "short" }) }));
  return <button type="button" className="crew-growth-final-performance" onClick={onOpen} aria-label="View my performance">
    <header><span><h2>Performance</h2><p>Your performance this month.</p></span></header>
    <div className="crew-growth-final-performance-body">
      <div className="crew-growth-final-score"><strong>{score ?? "—"}</strong><span>/100</span><i /><em><b>{performanceLevel(score)}</b><small>This month</small></em></div>
      <div className="crew-growth-final-trend" aria-label={trend.length > 1 ? "Recent performance trend" : "No performance trend yet"}>
        {trend.length > 1 ? <ResponsiveContainer width="100%" height="100%"><LineChart data={trend} margin={{ top: 12, right: 7, bottom: 5, left: 7 }}><XAxis dataKey="label" hide /><YAxis domain={[0, 100]} hide /><Tooltip content={() => null} /><Line type="monotone" dataKey="score" stroke="#079b69" strokeWidth={3} dot={{ r: 4, fill: "#fff", stroke: "#079b69", strokeWidth: 2 }} activeDot={false} /></LineChart></ResponsiveContainer> : <span>No trend yet</span>}
      </div>
    </div>
    <footer>View my performance <ChevronRight size={18} /></footer>
  </button>;
}

export default function CrewGrowthMobile({ data, performance, loading, error, onRetry, initialView = "overview" }) {
  const [view, setView] = useState(initialView);
  const [selectedSkill, setSelectedSkill] = useState(null);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("All");
  const [helpOpen, setHelpOpen] = useState(false);
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
  const readySkills = skills.filter((skill) => ["ready_for_review", "needs_renewal"].includes(skill.status));

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
      {selectedSkill.status === "ready_for_review" && <section className="crew-v3-next-action"><Target size={19} /><span><strong>Next Action</strong><small>Waiting for manager review</small></span></section>}
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

  return <section className="crew-v2-growth crew-growth-final">
    <PageHeader title="Growth" action={<button type="button" className="crew-growth-final-help" aria-label="Growth help" onClick={() => setHelpOpen(true)}><CircleHelp size={23} /></button>} />
    <GrowthMilestoneHero skill={nextMilestone} onOpen={openSkill} />
    <div className="crew-growth-final-skill-card">
      <GrowthSkillSummary summary={summary} onViewAll={() => setView("skills")} />
      <GrowthReadyList skills={readySkills} onOpen={openSkill} onViewAll={() => setView("skills")} />
    </div>
    <GrowthPerformanceCard performance={performance} onOpen={() => setView("performance")} />
    {helpOpen ? <GrowthHelpModal onClose={() => setHelpOpen(false)} /> : null}
  </section>;
}
