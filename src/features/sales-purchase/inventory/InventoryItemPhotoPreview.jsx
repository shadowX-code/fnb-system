import { useEffect } from 'react';
export default function InventoryItemPhotoPreview({ preview, onClose }) {
  useEffect(() => {
    if (!preview?.src) return undefined;
    function handleKeyDown(event) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose, preview?.src]);

  if (!preview?.src) return null;
  return (
    <div
      className="fixed inset-0 z-lightbox-layer flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label={preview.title || "Item photo preview"}
      onMouseDown={onClose}
    >
      <div className="flex max-h-[88vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-white/10 bg-slate-950 shadow-2xl" onMouseDown={(event) => event.stopPropagation()}>
        <div className="flex items-center justify-between gap-3 border-b border-white/10 px-4 py-3">
          <div className="min-w-0">
            <div className="truncate type-title font-bold text-white">{preview.title || "Item Photo"}</div>
            <div className="type-caption text-slate-300">Inventory item photo preview</div>
          </div>
          <button className="rounded-full border border-white/15 px-3 py-1 text-sm font-bold text-white transition hover:bg-white/10" type="button" onClick={onClose}>
            Close
          </button>
        </div>
        <div className="min-h-0 flex-1 p-3">
          <img className="mx-auto max-h-[72vh] w-auto max-w-full rounded-xl object-contain" src={preview.src} alt={preview.title || "Item photo"} />
        </div>
      </div>
    </div>
  );
}
