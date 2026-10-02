import { useRef, useState } from "react";
import { ASSET_MASTER_PHOTO_VARIANTS, coveredImageDimensions, normalizedCrop } from "../../utils/imageUpload.js";

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

// The Asset master crop is intentionally small: it only records framing for
// the canonical 4:3 presentation variants. It never alters inspection media.
export default function AssetPhotoCropper({ src, crop = {}, onChange, className = "" }) {
  const frameRef = useRef(null);
  const [source, setSource] = useState(null);
  const pointers = useRef(new Map());
  const last = useRef(null);
  const value = normalizedCrop(crop);
  const frame = ASSET_MASTER_PHOTO_VARIANTS.display;
  const bounds = source?.src === src
    ? coveredImageDimensions(source.width, source.height, frame.width, frame.height, value)
    : null;
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
      if (!bounds) return;
      // Pan is normalized over the actual overflow, exactly as in the saved crop.
      const overflowX = (bounds.width - frame.width) * rect.width / frame.width;
      const overflowY = (bounds.height - frame.height) * rect.height / frame.height;
      update({
        x: overflowX > 0 ? clamp(value.x + 2 * (event.clientX - previous.x) / overflowX, -1, 1) : value.x,
        y: overflowY > 0 ? clamp(value.y + 2 * (event.clientY - previous.y) / overflowY, -1, 1) : value.y,
      });
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
      <img src={src} alt="Asset photo crop preview"
        onLoad={(event) => setSource({ src, width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight })}
        style={bounds ? {
          width: `${bounds.width / frame.width * 100}%`,
          height: `${bounds.height / frame.height * 100}%`,
          left: `${bounds.x / frame.width * 100}%`,
          top: `${bounds.y / frame.height * 100}%`,
        } : { visibility: "hidden" }} />
    </div>
    <label className="asset-photo-cropper-zoom">Zoom<input aria-label="Photo zoom" type="range" min="1" max="3" step="0.01" value={value.zoom} onChange={(event) => update({ zoom: Number(event.target.value) })} /></label>
    <small>Drag to reposition. Pinch or use zoom to frame the Asset.</small>
  </div>;
}
