import { createContext, useContext, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import './AdminChart.css';

const ChartContext = createContext(null);

/** A measured SVG canvas. Coordinates and type stay legible in narrow analytical columns. */
export function AdminChart({ label, height = 300, children, className = '', dataKey }) {
  const ref = useRef(null), tooltipRef = useRef(null), tooltipId = useId();
  const [width, setWidth] = useState(640), [tip, setTip] = useState(null);
  useEffect(() => {
    if (!ref.current || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.max(240, Math.round(entry.contentRect.width))));
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => setTip(null), [dataKey, width]);
  useLayoutEffect(() => {
    if (!tip || !tooltipRef.current) return;
    const height = tooltipRef.current.getBoundingClientRect().height;
    const y = tip.above >= height + 8 ? tip.above - height - 8 : tip.below + 8;
    if (tip.y !== y) setTip(current => ({...current, y}));
  }, [tip]);
  const show = (element, content, owner) => {
    const host = ref.current.getBoundingClientRect(), mark = element.getBoundingClientRect();
    setTip({ content, owner, above: mark.top - host.top, below: mark.bottom - host.top, x: Math.max(8, Math.min(host.width - 232, mark.left - host.left + mark.width / 2 - 108)), y: Math.max(4, mark.top - host.top - 78) });
  };
  return <ChartContext.Provider value={{ show, hide: () => setTip(null), tooltipId, owner: tip?.owner }}><div ref={ref} className={`admin-chart ${className}`} onKeyDown={e => { if (e.key === 'Escape') setTip(null); }}>
    <svg viewBox={`0 0 ${width} ${typeof height === 'function' ? height(width) : height}`} role="group" aria-label={label}>{children(width, height)}</svg>
    {tip ? <div ref={tooltipRef} id={tooltipId} role="tooltip" className="admin-chart-tooltip" style={{ left: tip.x, top: tip.y }}>{tip.content}</div> : null}
  </div></ChartContext.Provider>;
}

/** Pointer, keyboard and touch all select the same canonical object and context. */
export function AdminChartMark({ label, tooltip, selected, dimmed, onSelect, children, className = '', ...geometry }) {
  const chart = useContext(ChartContext), owner = useId();
  return <g {...geometry} role="button" tabIndex={0} aria-label={label} aria-pressed={Boolean(selected)} aria-describedby={chart.owner === owner ? chart.tooltipId : undefined}
    className={`admin-chart-mark ${selected ? 'is-selected' : ''} ${dimmed ? 'is-receded' : ''} ${className}`}
    onPointerEnter={e => chart.show(e.currentTarget, tooltip, owner)} onPointerLeave={e => { if (e.pointerType !== 'touch') chart.hide(); }}
    onFocus={e => chart.show(e.currentTarget, tooltip, owner)} onBlur={chart.hide}
    onClick={e => { onSelect(); chart.show(e.currentTarget, tooltip, owner); }}
    onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(); chart.show(e.currentTarget, tooltip, owner); } }}>
    {children}
  </g>;
}

/** Interpolate display coordinates only; never interpolate or publish financial results. */
export function useAdminChartGeometry(target) {
  const signature = JSON.stringify(target), latest = useRef(target), frame = useRef();
  const [geometry, setGeometry] = useState(target);
  useEffect(() => {
    const media = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    const from = latest.current;
    const finish = () => { cancelAnimationFrame(frame.current); latest.current = target; setGeometry(target); };
    if (media?.matches || typeof requestAnimationFrame === 'undefined') { finish(); return; }
    let start;
    const step = time => {
      start ??= time;
      const progress = Math.min(1, (time - start) / 220), eased = 1 - (1 - progress) ** 3;
      const next = Object.fromEntries(Object.entries(target).map(([id, values]) => [id, values.map((value, index) => value + ((from[id]?.[index] ?? value) - value) * (1 - eased))]));
      latest.current = next; setGeometry(next);
      if (progress < 1) frame.current = requestAnimationFrame(step);
    };
    frame.current = requestAnimationFrame(step);
    const preference = () => { if (media.matches) finish(); };
    media?.addEventListener('change', preference);
    return () => { cancelAnimationFrame(frame.current); media?.removeEventListener('change', preference); };
    // Stable numeric signature avoids restarting motion on selection or tooltip updates.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature]);
  // Removed/missing evidence vanishes immediately; entering evidence begins at its real position.
  return Object.fromEntries(Object.entries(target).map(([id, values]) => [id, geometry[id]?.length === values.length ? geometry[id] : values]));
}

