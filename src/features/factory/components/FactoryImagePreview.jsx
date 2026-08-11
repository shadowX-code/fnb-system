import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { ImageOff, X } from "lucide-react";

const failedFactoryImageUrls = new Set();

export function FactoryBulkThumbnail({ item, onPreview }) {
  const imageUrl = String(item.imageUrl || "").trim();
  const [loading, setLoading] = useState(Boolean(imageUrl) && !failedFactoryImageUrls.has(imageUrl));
  const [failed, setFailed] = useState(() => failedFactoryImageUrls.has(imageUrl));

  useEffect(() => {
    const knownFailure = failedFactoryImageUrls.has(imageUrl);
    setLoading(Boolean(imageUrl) && !knownFailure);
    setFailed(knownFailure);
  }, [imageUrl]);

  if (!imageUrl || failed) return <div className="flex h-[52px] w-[52px] shrink-0 items-center justify-center rounded-lg border border-border bg-slate-100 text-text-muted" aria-hidden="true"><ImageOff size={20} /></div>;

  return (
    <button
      className="relative h-[52px] w-[52px] shrink-0 overflow-hidden rounded-lg border border-border bg-slate-100 outline-none transition hover:border-primary/50 focus:ring-2 focus:ring-primary/30"
      type="button"
      aria-label={`Preview image for ${item.primary || "item"}`}
      onClick={(event) => { event.preventDefault(); event.stopPropagation(); onPreview(item, event.currentTarget); }}
    >
      {loading ? <span className="absolute inset-0 animate-pulse bg-slate-200" aria-hidden="true" /> : null}
      <img className={`h-full w-full object-cover transition-opacity ${loading ? "opacity-0" : "opacity-100"}`} src={imageUrl} alt="" onLoad={() => setLoading(false)} onError={() => { failedFactoryImageUrls.add(imageUrl); setLoading(false); setFailed(true); }} />
    </button>
  );
}

export function FactoryImagePreview({ item, onClose }) {
  const imageUrl = String(item.imageUrl || "").trim();
  const [loading, setLoading] = useState(() => !failedFactoryImageUrls.has(imageUrl));
  const [failed, setFailed] = useState(() => failedFactoryImageUrls.has(imageUrl));

  useEffect(() => {
    function closeOnEscape(event) {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      onClose();
    }
    document.addEventListener("keydown", closeOnEscape, true);
    return () => document.removeEventListener("keydown", closeOnEscape, true);
  }, [onClose]);

  if (typeof document === "undefined") return null;
  return createPortal(
    <div className="fixed inset-0 z-lightbox-layer flex items-center justify-center bg-slate-950/70 p-3 backdrop-blur-sm sm:p-6" role="presentation" onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="flex max-h-[92vh] max-w-[92vw] flex-col overflow-hidden rounded-xl border border-white/20 bg-white shadow-2xl" role="dialog" aria-modal="true" aria-label={`Image preview for ${item.primary || "item"}`} onKeyDown={(event) => { if (event.key === "Tab") { event.preventDefault(); event.currentTarget.querySelector("button")?.focus?.(); } }}>
        <div className="flex shrink-0 items-center justify-between gap-4 border-b border-border px-4 py-3">
          <div className="min-w-0"><div className="truncate font-bold text-text-primary">{item.primary || "Item image"}</div>{item.code ? <div className="truncate text-xs font-semibold text-text-secondary">{item.code}</div> : null}</div>
          <button className="icon-btn shrink-0" type="button" aria-label="Close image preview" autoFocus onClick={onClose}><X size={18} /></button>
        </div>
        <div className="relative flex min-h-[180px] min-w-[min(80vw,320px)] items-center justify-center bg-slate-950 p-3 sm:p-5">
          {loading && !failed ? <div className="absolute inset-5 animate-pulse rounded-lg bg-slate-800" aria-hidden="true" /> : null}
          {failed ? <div className="flex flex-col items-center gap-2 px-8 py-12 text-center text-slate-300"><ImageOff size={28} /><span className="text-sm font-semibold">Image unavailable</span></div> : <img className={`max-h-[80vh] max-w-[80vw] object-contain transition-opacity ${loading ? "opacity-0" : "opacity-100"}`} src={imageUrl} alt={item.primary || "Item image"} onLoad={() => setLoading(false)} onError={() => { failedFactoryImageUrls.add(imageUrl); setLoading(false); setFailed(true); }} />}
        </div>
      </div>
    </div>,
    document.body,
  );
}
