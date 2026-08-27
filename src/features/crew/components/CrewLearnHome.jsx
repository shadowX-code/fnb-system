import { useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
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
import { formatCrewDate } from "../utils/crewI18n.js";
import { CrewMobilePageHeader, CrewStatusBadge } from "./CrewMobileUI.jsx";

const CATEGORY_ICONS = [
  [/service|guest|customer/i, ConciergeBell],
  [/opening|closing/i, DoorOpen],
  [/clean/i, Sparkles],
  [/food|kitchen|prep/i, Soup],
  [/beverage|drink|coffee/i, Coffee],
];

function categoryIcon(name) {
  return CATEGORY_ICONS.find(([pattern]) => pattern.test(name || ""))?.[1] || Shapes;
}

function readingMinutes(item) {
  return Number(item.estimated_minutes || item.reading_minutes || 0);
}

function formatAcknowledgedDate(item) {
  const value = item.acknowledged_at || item.acknowledgement_date;
  if (!value) return "";
  return formatCrewDate(value, { day: "numeric", month: "short", year: "numeric" });
}

export default function CrewLearnHome({ home, assignment, assignmentLoading, library, error, onOpenOnboarding, onOpenSop }) {
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
      {home?.assignment && (assignmentLoading
        ? <CrewLearnOnboardingSkeleton />
        : <CrewOnboardingProgressCard home={home} assignment={assignment} onOpen={onOpenOnboarding} />)}
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

function CrewLearnOnboardingSkeleton() {
  return <div className="crew-learn-loading-onboarding crew-learn-loading-onboarding--inline" aria-busy="true"><span /><div><b /><i /><em /></div></div>;
}

export function CrewLearnHero() {
  const { t } = useTranslation();
  return <CrewMobilePageHeader className="crew-learn-final-hero" title={t("learn.title")} subtitle={t("learn.tagline")} />;
}

export function CrewLearnSearch({ value, onChange, onFilter }) {
  const { t } = useTranslation();
  return (
    <div className="crew-learn-final-search-row">
      <label><Search size={21} aria-hidden="true" /><input aria-label={t("learn.search")} value={value} onChange={(event) => onChange(event.target.value)} placeholder={t("learn.search")} /></label>
      <button type="button" aria-label={t("learn.filters")} onClick={onFilter}><SlidersHorizontal size={21} /></button>
    </div>
  );
}

export function CrewOnboardingProgressCard({ home, assignment, onOpen }) {
  const { t } = useTranslation();
  const onboarding = home.assignment;
  const complete = onboarding.status === "completed";
  const progress = Math.max(0, Math.min(100, Number(onboarding.progress_percentage) || 0));
  const moduleTotal = assignment?.modules?.length || 0;
  const moduleDone = assignment?.modules?.filter((item) => item.completed).length || 0;
  const done = moduleTotal ? moduleDone : Number(onboarding.lessons_completed || 0);
  const total = moduleTotal || Number(onboarding.lessons_total || 0);
  const title = complete ? t("learn.onboardingComplete") : assignment?.journey?.name || "New Crew Onboarding";
  return (
    <button type="button" className={`crew-learn-final-onboarding ${complete ? "is-complete" : ""}`} onClick={onOpen} aria-label={`${title}, ${done} of ${total}`}>
      <span className="crew-ui-icon-container crew-learn-final-progress-icon"><CheckCircle2 size={23} /></span>
      <span className="crew-learn-final-onboarding-copy">
        <strong>{complete ? t("learn.onboardingComplete") : title}</strong>
        <small>{complete ? t("learn.greatJob") : t("learn.continueJourney")}</small>
        <span><b>{done}</b> / {total} {moduleTotal ? t("learn.modules") : t("learn.lessons")}<i>•</i><em>{complete ? t("learn.reviewAnytime") : t("learn.percentComplete", { count: progress })}</em></span>
        <span className="crew-ui-progress crew-learn-final-onboarding-progress" aria-label={t("learn.percentComplete", { count: progress })}><span style={{ width: `${progress}%` }} /></span>
      </span>
      <span className="crew-learn-final-onboarding-next"><ChevronRight size={21} /></span>
    </button>
  );
}

export const CrewSopCategoryCarousel = ({ categories, sops, value, onChange, onViewAll, ref }) => {
  const { t } = useTranslation();
  return <section className="crew-learn-final-categories">
    <header><h2>{t("learn.browseCategory")}</h2><button type="button" onClick={onViewAll}>{t("common.viewAll")} <ChevronRight size={17} /></button></header>
    <div className="crew-learn-final-category-scroll" ref={ref} aria-label={t("learn.filters")}>
      <CrewSopCategoryCard name={t("learn.all")} count={sops.length} icon={Grid2X2} active={value === "all"} onClick={() => onChange("all")} />
      {categories.map((item) => <CrewSopCategoryCard key={item.id} name={item.name} count={sops.filter((sop) => sop.category_id === item.id).length} icon={categoryIcon(item.name)} active={value === item.id} onClick={() => onChange(item.id)} />)}
    </div>
  </section>
};

export function CrewSopCategoryCard({ name, count, icon: Icon, active, onClick }) {
  const { t } = useTranslation();
  return <button type="button" className={`crew-learn-final-category ${active ? "is-active" : ""}`} aria-label={`${name}, ${count} ${t("learn.sops")}`} aria-pressed={active} onClick={onClick}><span className={`crew-ui-icon-container ${active ? "is-selected is-active" : ""}`}><Icon size={23} /></span><strong>{name}</strong><small>{count} {t("learn.sops")}</small></button>;
}

export function CrewSopLibrary({ sops, sort, onSort, onOpen }) {
  const { t } = useTranslation();
  return (
    <section className="crew-learn-final-library">
      <header><h2>{t("learn.sops")} ({sops.length})</h2><button type="button" onClick={onSort}>{sort === "latest" ? t("learn.latest") : t("learn.titleSort")} <ChevronDown size={16} /></button></header>
      <div className="crew-learn-final-list">
        {sops.map((item) => <CrewSopListItem key={item.version_id || item.id} item={item} onOpen={() => onOpen(item.version_id)} />)}
        {!sops.length && <p className="crew-learn-final-empty">{t("learn.noSops")}</p>}
      </div>
    </section>
  );
}

export function CrewSopListItem({ item, onOpen }) {
  const { t } = useTranslation();
  const minutes = readingMinutes(item);
  return (
    <button type="button" className="crew-learn-final-sop" onClick={onOpen} aria-label={t("learn.openSop", { title: item.title })}>
      <span className="crew-learn-final-doc crew-ui-icon-container"><FileText size={22} /></span>
      <span className="crew-learn-final-sop-copy"><strong className="crew-list-dense-primary">{item.title}</strong><small>{item.category || t("common.other")}<i>•</i>v{item.version}</small>{minutes > 0 && <small><Clock3 size={13} /> {t("learn.estimatedMinutes", { count: minutes })}</small>}</span>
      <CrewSopAcknowledgementState item={item} />
      <ChevronRight className="crew-learn-final-chevron" size={19} />
    </button>
  );
}

export function CrewSopAcknowledgementState({ item }) {
  const { t } = useTranslation();
  if (item.acknowledged) {
    const date = formatAcknowledgedDate(item);
    return <span className="crew-learn-final-ack is-done"><CrewStatusBadge tone="success"><CheckCircle2 size={14} /> {t("learn.acknowledged")}</CrewStatusBadge>{date && <small>{date}</small>}</span>;
  }
  return <span className="crew-learn-final-ack"><CrewStatusBadge tone={item.acknowledgement_required ? "warning" : "neutral"}>{item.acknowledgement_required ? t("common.required") : t("common.optional")}</CrewStatusBadge></span>;
}
