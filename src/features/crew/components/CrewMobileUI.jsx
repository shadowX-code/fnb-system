import { ChevronRight, Search } from "lucide-react";
import { useTranslation } from "react-i18next";
import "../../../i18n/index.js";

export function CrewMobilePage({ className = "", children }) {
  return <section className={`crew-ui-page ${className}`.trim()}>{children}</section>;
}

export function CrewHeroCard({ className = "", children }) {
  return <article className={`crew-ui-hero ${className}`.trim()}>{children}</article>;
}

export function CrewSectionHeader({ title, meta, action, actionLabel, onAction }) {
  return <div className="crew-ui-section-head"><h2 className="crew-type-section-title">{title}{meta !== undefined && <span>{meta}</span>}</h2>{action && <button type="button" aria-label={actionLabel} onClick={onAction}>{action}</button>}</div>;
}

export function CrewStatusBadge({ children, tone = "neutral" }) {
  return <span className={`crew-ui-status crew-type-status is-${tone}`}>{children}</span>;
}

export function CrewProgressBar({ value = 0, label }) {
  const { t } = useTranslation();
  const safe = Math.max(0, Math.min(100, Number(value) || 0));
  return <div className="crew-ui-progress" aria-label={label || t("learn.percentComplete", { count: safe })}><span style={{ width: `${safe}%` }} /></div>;
}

export function CrewActionRow({ icon: Icon, title, subtitle, meta, tone = "blue", onClick, disabled = false, children }) {
  const content = <><span className={`crew-ui-row-icon is-${tone}`}>{Icon && <Icon size={18} />}</span><span className="crew-ui-row-copy"><strong className="crew-type-card-title">{title}</strong>{subtitle && <small className="crew-type-secondary">{subtitle}</small>}{children}</span>{meta && <em className="crew-type-status">{meta}</em>}{onClick && <ChevronRight size={17} />}</>;
  return onClick ? <button type="button" className="crew-ui-action-row" onClick={onClick} disabled={disabled}>{content}</button> : <div className="crew-ui-action-row">{content}</div>;
}

export function CrewInfoRow({ label, value, supporting }) {
  return <div className="crew-ui-info-row"><span><strong>{label}</strong>{supporting && <small>{supporting}</small>}</span><em>{value}</em></div>;
}

export function CrewSearchBar({ value, onChange, onSubmit, placeholder }) {
  const { t } = useTranslation();
  const copy = placeholder || t("learn.search");
  return <form className="crew-ui-search" onSubmit={(event) => { event.preventDefault(); onSubmit?.(value); }}><Search size={18} /><input aria-label={copy} value={value} onChange={(event) => onChange(event.target.value)} placeholder={copy} /><button type="submit" aria-label={t("common.submit")}><Search size={17} /></button></form>;
}

export function CrewMetric({ value, label, tone = "neutral", onClick }) {
  const content = <><strong>{value}</strong><span>{label}</span></>;
  return onClick ? <button type="button" className={`crew-ui-metric is-${tone}`} onClick={onClick}>{content}</button> : <div className={`crew-ui-metric is-${tone}`}>{content}</div>;
}

export function CrewEmptyState({ title, body }) {
  return <div className="crew-ui-empty"><strong>{title}</strong>{body && <p>{body}</p>}</div>;
}

export function CrewBottomNav({ items, active, onChange }) {
  const { t } = useTranslation();
  return <nav className="crew-v2-nav" aria-label={t("nav.label")}>{items.map(({ id, label, icon: Icon }) => <button type="button" key={id} className={active === id ? "active" : ""} onClick={() => onChange(id)}><Icon size={19} /><span className="crew-type-nav-label">{t(`nav.${id}`, { defaultValue: label })}</span></button>)}</nav>;
}
