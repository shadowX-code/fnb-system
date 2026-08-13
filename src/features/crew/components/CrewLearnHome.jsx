import { useMemo, useRef, useState } from "react";
import {
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock3,
  Coffee,
  ConciergeBell,
  DoorOpen,
  FileText,
  Grid2X2,
  Search,
  Shapes,
  SlidersHorizontal,
  Sparkles,
  Soup,
} from "lucide-react";
import learnBookSearch from "../../../assets/crew/learn-book-search.png";

const CATEGORY_ICONS = [
  [/service|guest|customer/i, ConciergeBell],
  [/opening|closing/i, DoorOpen],
  [/clean/i, Sparkles],
  [/food|kitchen|prep/i, Soup],
  [/beverage|drink|coffee/i, Coffee],
];

const CATEGORY_TONES = ["mint", "rose", "lilac", "amber", "sage", "peach"];

function categoryIcon(name) {
  return CATEGORY_ICONS.find(([pattern]) => pattern.test(name || ""))?.[1] || Shapes;
}

function readingMinutes(item) {
  return Number(item.estimated_minutes || item.reading_minutes || 0);
}

function formatAcknowledgedDate(item) {
  const value = item.acknowledged_at || item.acknowledgement_date;
  if (!value) return "";
  return new Intl.DateTimeFormat("en-MY", { day: "numeric", month: "short", year: "numeric" }).format(new Date(value));
}

export default function CrewLearnHome({ home, assignment, library, error, onOpenOnboarding, onOpenSop }) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("all");
  const [sort, setSort] = useState("latest");
  const categoryRowRef = useRef(null);
  const sops = library?.sops || [];
  const categories = library?.categories || [];

  const visibleSops = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return sops
      .filter((item) => category === "all" || item.category_id === category)
      .filter((item) => !normalized || `${item.title} ${item.summary || ""} ${item.category || ""}`.toLowerCase().includes(normalized))
      .sort((a, b) => sort === "title"
        ? String(a.title).localeCompare(String(b.title))
        : new Date(b.updated_at || 0) - new Date(a.updated_at || 0));
  }, [category, query, sort, sops]);

  function viewAll() {
    setCategory("all");
    setQuery("");
    if (typeof categoryRowRef.current?.scrollTo === "function") {
      categoryRowRef.current.scrollTo({ left: 0, behavior: "smooth" });
    }
  }

  function focusFilters() {
    categoryRowRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    categoryRowRef.current?.querySelector("button")?.focus({ preventScroll: true });
  }

  return (
    <section className="crew-learn-final-home">
      <CrewLearnHero />
      {error && <p className="crew-mobile-error">{error}</p>}
      <CrewLearnSearch value={query} onChange={setQuery} onFilter={focusFilters} />
      {home?.assignment && <CrewOnboardingProgressCard home={home} assignment={assignment} onOpen={onOpenOnboarding} />}
      <CrewSopCategoryCarousel
        ref={categoryRowRef}
        categories={categories}
        sops={sops}
        value={category}
        onChange={setCategory}
        onViewAll={viewAll}
      />
      <CrewSopLibrary
        sops={visibleSops}
        sort={sort}
        onSort={() => setSort((current) => current === "latest" ? "title" : "latest")}
        onOpen={onOpenSop}
      />
    </section>
  );
}

export function CrewLearnHero() {
  return (
    <header className="crew-learn-final-hero">
      <div><h1>Learn</h1><p>Learn. Apply. <strong>Grow together.</strong></p></div>
      <img src={learnBookSearch} alt="" aria-hidden="true" />
    </header>
  );
}

export function CrewLearnSearch({ value, onChange, onFilter }) {
  return (
    <div className="crew-learn-final-search-row">
      <label><Search size={21} aria-hidden="true" /><input aria-label="Search SOP, topic or keyword" value={value} onChange={(event) => onChange(event.target.value)} placeholder="Search SOP, topic or keyword" /></label>
      <button type="button" aria-label="Browse SOP filters" onClick={onFilter}><SlidersHorizontal size={21} /></button>
    </div>
  );
}

export function CrewOnboardingProgressCard({ home, assignment, onOpen }) {
  const onboarding = home.assignment;
  const complete = onboarding.status === "completed";
  const progress = Math.max(0, Math.min(100, Number(onboarding.progress_percentage) || 0));
  const moduleTotal = assignment?.modules?.length || 0;
  const moduleDone = assignment?.modules?.filter((item) => item.completed).length || 0;
  const done = moduleTotal ? moduleDone : Number(onboarding.lessons_completed || 0);
  const total = moduleTotal || Number(onboarding.lessons_total || 0);
  const title = complete ? "Onboarding Completed" : assignment?.journey?.name || "New Crew Onboarding";
  return (
    <button type="button" className={`crew-learn-final-onboarding ${complete ? "is-complete" : ""}`} onClick={onOpen} aria-label={`${title}, ${done} of ${total}`}>
      <span className="crew-learn-final-progress-ring" style={{ "--progress": `${progress * 3.6}deg` }}><CheckCircle2 size={25} /></span>
      <span className="crew-learn-final-onboarding-copy">
        <strong>{complete ? "Onboarding Completed!" : title}</strong>
        <small>{complete ? "Great job! You’ve completed all modules." : "Continue your required learning journey."}</small>
        <span><b>{done}</b> / {total} {moduleTotal ? "modules" : "lessons"}<i>•</i><em>{complete ? "Review anytime" : `${progress}% complete`}</em></span>
      </span>
      <span className="crew-learn-final-onboarding-next"><ChevronRight size={21} /></span>
    </button>
  );
}

export const CrewSopCategoryCarousel = ({ categories, sops, value, onChange, onViewAll, ref }) => (
  <section className="crew-learn-final-categories">
    <header><h2>Browse by category</h2><button type="button" onClick={onViewAll}>View all <ChevronRight size={17} /></button></header>
    <div className="crew-learn-final-category-scroll" ref={ref} aria-label="SOP categories">
      <CrewSopCategoryCard name="All" count={sops.length} icon={Grid2X2} tone="mint" active={value === "all"} onClick={() => onChange("all")} />
      {categories.map((item, index) => <CrewSopCategoryCard key={item.id} name={item.name} count={sops.filter((sop) => sop.category_id === item.id).length} icon={categoryIcon(item.name)} tone={CATEGORY_TONES[(index + 1) % CATEGORY_TONES.length]} active={value === item.id} onClick={() => onChange(item.id)} />)}
    </div>
  </section>
);

export function CrewSopCategoryCard({ name, count, icon: Icon, tone, active, onClick }) {
  return <button type="button" className={`crew-learn-final-category is-${tone} ${active ? "is-active" : ""}`} aria-label={`${name}, ${count} ${count === 1 ? "SOP" : "SOPs"}`} aria-pressed={active} onClick={onClick}><span><Icon size={23} /></span><strong>{name}</strong><small>{count} {count === 1 ? "SOP" : "SOPs"}</small></button>;
}

export function CrewSopLibrary({ sops, sort, onSort, onOpen }) {
  return (
    <section className="crew-learn-final-library">
      <header><h2>SOPs ({sops.length})</h2><button type="button" onClick={onSort}>{sort === "latest" ? "Latest" : "Title"} <ChevronDown size={16} /></button></header>
      <div className="crew-learn-final-list">
        {sops.map((item) => <CrewSopListItem key={item.version_id || item.id} item={item} onOpen={() => onOpen(item.version_id)} />)}
        {!sops.length && <p className="crew-learn-final-empty">No SOPs match this search.</p>}
      </div>
    </section>
  );
}

export function CrewSopListItem({ item, onOpen }) {
  const minutes = readingMinutes(item);
  return (
    <button type="button" className="crew-learn-final-sop" onClick={onOpen} aria-label={`Open ${item.title}`}>
      <span className="crew-learn-final-doc"><FileText size={22} /></span>
      <span className="crew-learn-final-sop-copy"><strong>{item.title}</strong><small>{item.category || "Other"}<i>•</i>v{item.version}</small>{minutes > 0 && <small><Clock3 size={13} /> Est. {minutes} min</small>}</span>
      <CrewSopAcknowledgementState item={item} />
      <ChevronRight className="crew-learn-final-chevron" size={19} />
    </button>
  );
}

export function CrewSopAcknowledgementState({ item }) {
  if (item.acknowledged) {
    const date = formatAcknowledgedDate(item);
    return <span className="crew-learn-final-ack is-done"><strong><CheckCircle2 size={16} /> Acknowledged</strong>{date && <small>{date}</small>}</span>;
  }
  return <span className="crew-learn-final-ack"><b className={item.acknowledgement_required ? "is-required" : "is-optional"}>{item.acknowledgement_required ? "Required" : "Optional"}</b><strong>Acknowledge</strong></span>;
}
