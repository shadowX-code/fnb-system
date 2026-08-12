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

export default function CrewGrowthMobile({ data, loading, error, onRetry }) {
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
        <span className={`crew-v2-status ${statusClass(selectedSkill.status)}`}>{statusCopy[selectedSkill.status] || selectedSkill.status}</span>
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
    <div className="crew-v2-skill-list">{filtered.map((skill) => <button type="button" key={skill.id} onClick={() => openSkill(skill)}>
      <div className="crew-v2-row-icon"><BookOpenCheck size={17} /></div>
      <span><strong>{skill.name}</strong><small>{skill.category}</small>{skill.status === "in_progress" && <ProgressBar value={percentFor(skill)} />}</span>
      <em className={`crew-v2-status ${statusClass(skill.status)}`}>{statusCopy[skill.status] || skill.status}</em>
      <ChevronRight size={16} />
    </button>)}</div>
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

  if (view === "performance") return <section className="crew-v2-growth">
    <PageHeader title="Performance" onBack={() => setView("overview")} />
    <section className="crew-v2-performance-empty"><Target size={28} /><h2>Performance is coming soon</h2><p>Your verified score and breakdown will appear here when Performance is enabled for your outlet.</p></section>
  </section>;

  return <section className="crew-v2-growth">
    <PageHeader title="Growth" />
    <nav className="crew-v2-growth-tabs" aria-label="Growth sections">
      <button type="button" className="active">Overview</button>
      <button type="button" onClick={() => setView("skills")}>Skills</button>
      <button type="button" onClick={() => setView("path")}>My Path</button>
    </nav>
    <article className="crew-v2-growth-hero"><small>My Growth</small><h2>{overall}% complete</h2><p>{summary.certified ? `${summary.certified} certified skill${summary.certified === 1 ? "" : "s"}` : "Build confidence one skill at a time"}</p><ProgressBar value={overall} /><span>{completeRequirements} / {allRequirements || 0} requirements</span></article>
    <section className="crew-v2-section-block"><div className="crew-v2-section-title"><h2>My progress</h2><button type="button" onClick={() => setView("skills")}>View skills</button></div><div className="crew-v2-growth-stats">
      <button type="button" onClick={() => setView("certifications")}><BadgeCheck size={18} /><span>Certified</span><strong>{summary.certified || 0}</strong></button>
      <button type="button" onClick={() => setView("skills")}><Clock3 size={18} /><span>In Progress</span><strong>{summary.in_progress || 0}</strong></button>
      <button type="button" onClick={() => setView("certifications")}><Award size={18} /><span>Ready</span><strong>{summary.ready_for_review || 0}</strong></button>
      <button type="button" onClick={() => setView("skills")}><Circle size={18} /><span>Not Started</span><strong>{summary.not_started || 0}</strong></button>
    </div></section>
    <div className="crew-v2-growth-links">
      <button type="button" onClick={() => setView("skills")}><BookOpenCheck size={18} /><span><strong>Skills</strong><small>See requirements and evidence</small></span><ChevronRight size={17} /></button>
      <button type="button" onClick={() => setView("path")}><Target size={18} /><span><strong>My Path</strong><small>Your next milestone and history</small></span><ChevronRight size={17} /></button>
      <button type="button" onClick={() => setView("certifications")}><Award size={18} /><span><strong>My Certifications</strong><small>Ready, in progress and completed</small></span><ChevronRight size={17} /></button>
      <button type="button" onClick={() => setView("performance")}><Sparkles size={18} /><span><strong>Performance</strong><small>{data?.performance ? "View your score" : "Coming soon"}</small></span><ChevronRight size={17} /></button>
    </div>
  </section>;
}
