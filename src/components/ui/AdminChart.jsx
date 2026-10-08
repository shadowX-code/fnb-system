import { createContext, useContext, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import './AdminChart.css';

const ChartContext = createContext(null);

/** A measured SVG canvas. Coordinates and type stay legible in narrow analytical columns. */
export function AdminChart({ label, height = 300, children, className = '', dataKey }) {
  const ref = useRef(null), tooltipRef = useRef(null), tooltipId = useId();
  const [width, setWidth] = useState(640), [tip, setTip] = useState(null);
  useEffect(() => {
    if (!ref.current || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(([entry]) => { if (entry.contentRect.width > 0) setWidth(Math.max(240, Math.round(entry.contentRect.width))); });
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => setTip(null), [dataKey, width]);
  useLayoutEffect(() => {
    if (!tip || !tooltipRef.current) return;
    const height = tooltipRef.current.getBoundingClientRect().height;
    const y = tip.above >= height + 8 ? tip.above - height - 8 : tip.below + 8;
    if (tip.y !== y) setTip(current => ({...current, y}));
  }, [tip?.content, tip?.above, tip?.below]);
  const show = (element, content, owner, anchor) => {
    const host = ref.current.getBoundingClientRect();
    const svg = element.ownerSVGElement, scale = host.width / Number(svg?.getAttribute('viewBox')?.split(' ')[2] || host.width || 1);
    const mark = anchor ? {left:host.left+anchor.x*scale,top:host.top+anchor.y*scale,bottom:host.top+anchor.y*scale,width:0} : element.getBoundingClientRect();
    setTip({ content, owner, above: mark.top - host.top, below: mark.bottom - host.top, x: Math.max(8, Math.min(host.width - 232, mark.left - host.left + mark.width / 2 - 108)), y: Math.max(4, mark.top - host.top - 78) });
  };
  return <ChartContext.Provider value={{ show, hide: () => setTip(null), tooltipId, owner: tip?.owner }}><div ref={ref} className={`admin-chart ${className}`} onKeyDown={e => { if (e.key === 'Escape') setTip(null); }}>
    <svg viewBox={`0 0 ${width} ${typeof height === 'function' ? height(width) : height}`} role="group" aria-label={label}>{children(width, height)}</svg>
    {tip ? <div ref={tooltipRef} id={tooltipId} role="tooltip" className="admin-chart-tooltip" style={{ left: tip.x, top: tip.y }}>{tip.content}</div> : null}
  </div></ChartContext.Provider>;
}

/** Pointer, keyboard and touch all select the same canonical object and context. */
export function AdminChartMark({ label, tooltip, selected, dimmed, onSelect, onInspect, tooltipAnchor, children, className = '', ...geometry }) {
  const chart = useContext(ChartContext), owner = useId();
  return <g {...geometry} data-admin-chart-mark="true" role="button" tabIndex={0} aria-label={label} aria-pressed={Boolean(selected)} aria-describedby={chart.owner === owner ? chart.tooltipId : undefined}
    className={`admin-chart-mark ${selected ? 'is-selected' : ''} ${dimmed ? 'is-receded' : ''} ${className}`}
    onPointerEnter={e => { chart.show(e.currentTarget, tooltip, owner, tooltipAnchor); onInspect?.(true); }} onPointerLeave={e => { if (e.pointerType !== 'touch') { chart.hide(); onInspect?.(false); } }}
    onFocus={e => { chart.show(e.currentTarget, tooltip, owner, tooltipAnchor); onInspect?.(true); }} onBlur={() => { chart.hide(); onInspect?.(false); }}
    onClick={e => { onSelect(); chart.show(e.currentTarget, tooltip, owner, tooltipAnchor); }}
    onKeyDown={e => {
      if (['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End'].includes(e.key)) {
        e.preventDefault();
        const marks = [...e.currentTarget.closest('svg').querySelectorAll('[data-admin-chart-mark]')];
        const index = marks.indexOf(e.currentTarget), next = e.key === 'Home' ? 0 : e.key === 'End' ? marks.length - 1 : Math.max(0, Math.min(marks.length - 1, index + (['ArrowRight','ArrowDown'].includes(e.key) ? 1 : -1)));
        marks[next]?.focus();
      }
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(); chart.show(e.currentTarget, tooltip, owner, tooltipAnchor); } }}>
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
    const finish = () => { if (typeof cancelAnimationFrame !== 'undefined') cancelAnimationFrame(frame.current); latest.current = target; setGeometry(target); };
    if (signature === JSON.stringify(from) || media?.matches || typeof requestAnimationFrame === 'undefined') { finish(); return; }
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


/** Rounded, zero-inclusive quantitative ticks; this changes display scales, never measures. */
export function adminChartScale(values, intervals = 4) {
  const finite = values.filter(Number.isFinite), low = Math.min(0, ...finite), high = Math.max(0, ...finite);
  const raw = (high - low || 1) / intervals, power = 10 ** Math.floor(Math.log10(raw));
  const normalized = raw / power;
  const step = (normalized < 1.25 ? 1 : normalized < 2.25 ? 2 : normalized < 3.75 ? 2.5 : normalized < 7.5 ? 5 : 10) * power;
  const min = Math.floor(low / step) * step, max = Math.max(min + step, Math.ceil(high / step) * step);
  return { min, max, ticks: Array.from({length: Math.round((max-min)/step)+1}, (_, index) => Number((min+index*step).toPrecision(12))) };
}

/** A shared inspection guide, intentionally immediate so it tracks the inspected observation. */
export function AdminChartCrosshair({x, top, bottom}) {
  return Number.isFinite(x) ? <line aria-hidden="true" className="admin-chart-crosshair" x1={x} x2={x} y1={top} y2={bottom}/> : null;
}
