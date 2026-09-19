import { useRef } from "react";

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

// The Asset master crop is intentionally small: it only records framing for
// the canonical 4:3 presentation variants. It never alters inspection media.
export default function AssetPhotoCropper({ src, crop = {}, onChange, className = "" }) {
  const frameRef = useRef(null);
  const pointers = useRef(new Map());
  const last = useRef(null);
  const value = { zoom: clamp(Number(crop.zoom) || 1, 1, 3), x: clamp(Number(crop.x) || 0, -1, 1), y: clamp(Number(crop.y) || 0, -1, 1) };
  const update = (next) => onChange({ ...value, ...next });

  function pointerDown(event) {
    event.currentTarget.setPointerCapture?.(event.pointerId);
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    last.current = new Map(pointers.current);
  }
  function pointerMove(event) {
    if (!pointers.current.has(event.pointerId) || !frameRef.current) return;
    const previous = pointers.current.get(event.pointerId);
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const points = [...pointers.current.values()];
    const rect = frameRef.current.getBoundingClientRect();
    if (points.length === 1 && previous) {
      update({ x: clamp(value.x + ((event.clientX - previous.x) / rect.width) * 2, -1, 1), y: clamp(value.y + ((event.clientY - previous.y) / rect.height) * 2, -1, 1) });
    } else if (points.length === 2 && last.current instanceof Map) {
      const prior = [...last.current.values()];
      if (prior.length === 2) {
        const before = Math.hypot(prior[0].x - prior[1].x, prior[0].y - prior[1].y);
        const after = Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y);
        if (before) update({ zoom: clamp(value.zoom * (after / before), 1, 3) });
      }
    }
    last.current = new Map(pointers.current);
  }
  function pointerEnd(event) { pointers.current.delete(event.pointerId); last.current = new Map(pointers.current); }

  return <div className={`asset-photo-cropper ${className}`}>
    <div ref={frameRef} className="asset-photo-cropper-frame" onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerEnd} onPointerCancel={pointerEnd}>
      <img src={src} alt="Asset photo crop preview" style={{ transform: `translate(${value.x * 50}%, ${value.y * 50}%) scale(${value.zoom})` }} />
    </div>
    <label className="asset-photo-cropper-zoom">Zoom<input aria-label="Photo zoom" type="range" min="1" max="3" step="0.01" value={value.zoom} onChange={(event) => update({ zoom: Number(event.target.value) })} /></label>
    <small>Drag to reposition. Pinch or use zoom to frame the Asset.</small>
  </div>;
}
