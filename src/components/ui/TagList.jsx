export default function TagList({ tags = [] }) {
  return tags.length ? <span className="flex flex-wrap gap-1">{tags.map(tag => <span key={tag.id || tag.name || tag} title={tag.status === "archived" ? "Archived tag" : undefined} className="rounded border border-border bg-[var(--theme-subtle)] px-1.5 py-0.5 text-xs font-normal text-text-secondary">{tag.name || tag}</span>)}</span> : <span className="text-text-muted">—</span>;
}
