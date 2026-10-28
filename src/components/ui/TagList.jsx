import { useId, useRef, useState } from "react";
import FloatingLayer from "./FloatingLayer.jsx";

export default function TagList({ tags = [], maxVisible, label = "tags" }) {
  const [open, setOpen] = useState(false);
  const anchor = useRef(null);
  const id = useId();
  const visible = maxVisible === undefined ? tags : tags.slice(0, maxVisible);
  const hidden = tags.slice(visible.length);
  return tags.length ? <span className={`flex gap-1 ${maxVisible === undefined ? "flex-wrap" : "max-w-full items-center"}`}>
    {visible.map(tag => <span key={tag.id || tag.name || tag} title={tag.status === "archived" ? "Archived tag" : maxVisible === undefined ? undefined : tag.name || tag} className={`rounded border border-border bg-[var(--theme-subtle)] px-1.5 py-0.5 text-xs font-normal text-text-secondary ${maxVisible === undefined ? "min-w-0 max-w-full break-words" : "min-w-0 max-w-32 truncate"}`}>{tag.name || tag}</span>)}
    {hidden.length ? <><button ref={anchor} type="button" aria-label={`Show ${hidden.length} more ${label}`} aria-expanded={open} aria-haspopup="dialog" aria-controls={open ? id : undefined} onClick={() => setOpen(current => !current)} className="shrink-0 rounded border border-border bg-[var(--theme-subtle)] px-1.5 py-0.5 text-xs text-text-secondary hover:text-text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary">+{hidden.length}</button>
      <FloatingLayer open={open} onOpenChange={setOpen} anchorRef={anchor} align="start" width={300} maxHeight={240} focusOnOpen className="p-3"><span id={id} role="dialog" aria-label={`More ${label}`} tabIndex={-1} className="block"><TagList tags={hidden} /></span></FloatingLayer>
    </> : null}
  </span> : <span className="text-text-muted">—</span>;
}
