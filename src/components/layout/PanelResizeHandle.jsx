import { useRef } from 'react';
import './PanelResizeHandle.css';

/** Accessible presentation-only divider. The owning workspace supplies bounded widths. */
export default function PanelResizeHandle({ label, value, min, max, onChange, reverse = false }) {
  const drag = useRef(null);
  const clamp = (next) => Math.max(min, Math.min(max, next));
  return <div className="workspace-panel-resizer" role="separator" tabIndex={0}
    aria-label={label} aria-orientation="vertical" aria-valuemin={min} aria-valuemax={max} aria-valuenow={value} aria-valuetext={`${Math.round(value)} pixels`}
    onPointerDown={event => {
      if (event.button !== 0) return;
      drag.current = { x: event.clientX, value };
      event.currentTarget.setPointerCapture(event.pointerId);
    }}
    onPointerMove={event => {
      if (drag.current) onChange(clamp(drag.current.value + (event.clientX - drag.current.x) * (reverse ? -1 : 1)));
    }}
    onPointerUp={event => { drag.current = null; event.currentTarget.releasePointerCapture(event.pointerId); }}
    onPointerCancel={() => { drag.current = null; }}
    onKeyDown={event => {
      const delta = (event.key === 'ArrowRight' ? 16 : event.key === 'ArrowLeft' ? -16 : 0) * (reverse ? -1 : 1);
      if (!delta && !['Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      onChange(event.key === 'Home' ? min : event.key === 'End' ? max : clamp(value + delta));
    }}><span /></div>;
}
