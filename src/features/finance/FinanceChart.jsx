import { createContext, useContext, useEffect, useId, useRef, useState } from 'react';
import './interactive-visuals.css';

const ChartContext = createContext(null);

/** A measured SVG canvas. Coordinates and type stay legible in narrow analytical columns. */
export function FinanceChart({ label, height = 300, children, className = '', dataKey }) {
  const ref = useRef(null), tooltipId = useId();
  const [width, setWidth] = useState(640), [tip, setTip] = useState(null);
  useEffect(() => {
    if (!ref.current || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.max(240, Math.round(entry.contentRect.width))));
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => setTip(null), [dataKey]);
  const show = (element, content, owner) => {
    const host = ref.current.getBoundingClientRect(), mark = element.getBoundingClientRect();
    setTip({ content, owner, x: Math.max(8, Math.min(host.width - 232, mark.left - host.left + mark.width / 2 - 108)), y: Math.max(4, mark.top - host.top - 78) });
  };
  return <ChartContext.Provider value={{ show, hide: () => setTip(null), tooltipId, owner: tip?.owner }}><div ref={ref} className={`finance-chart ${className}`} onKeyDown={e => { if (e.key === 'Escape') setTip(null); }}>
    <svg viewBox={`0 0 ${width} ${height}`} role="group" aria-label={label}>{children(width, height)}</svg>
    {tip ? <div id={tooltipId} role="tooltip" className="finance-chart-tooltip" style={{ left: tip.x, top: tip.y }}>{tip.content}</div> : null}
  </div></ChartContext.Provider>;
}

/** Pointer, keyboard and touch all select the same canonical object and context. */
export function FinanceMark({ label, tooltip, selected, dimmed, onSelect, children, className = '', ...geometry }) {
  const chart = useContext(ChartContext), owner = useId();
  return <g {...geometry} role="button" tabIndex={0} aria-label={label} aria-pressed={Boolean(selected)} aria-describedby={chart.owner === owner ? chart.tooltipId : undefined}
    className={`finance-chart-mark ${selected ? 'is-selected' : ''} ${dimmed ? 'is-receded' : ''} ${className}`}
    onPointerEnter={e => chart.show(e.currentTarget, tooltip, owner)} onPointerLeave={e => { if (e.pointerType !== 'touch') chart.hide(); }}
    onFocus={e => chart.show(e.currentTarget, tooltip, owner)} onBlur={chart.hide}
    onClick={e => { onSelect(); chart.show(e.currentTarget, tooltip, owner); }}
    onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(); chart.show(e.currentTarget, tooltip, owner); } }}>
    {children}
  </g>;
}

/** Interpolate display coordinates only; never interpolate or publish financial results. */
export function useFinanceGeometry(target) {
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

/** Place labels without moving financial coordinates. Hide excess labels; tooltips/ledgers retain every item. */
export function placeFinanceLabels(points, width, top, bottom, selectedId) {
  const occupied = [], labels = {};
  const ordered = [...points].sort((a, b) => Number(b.id === selectedId) - Number(a.id === selectedId));
  for (const point of ordered) {
    const textWidth = Math.min(145, point.label.length * 6.2);
    for (const dy of [-14, 22, -34, 42]) {
      const left = Math.max(52, Math.min(width - textWidth - 8, point.x + 14));
      const y = point.y + dy, box = { left, right: left + textWidth, top: y - 12, bottom: y + 3 };
      if (box.top < top || box.bottom > bottom || occupied.some(other => box.left < other.right + 5 && box.right > other.left - 5 && box.top < other.bottom + 3 && box.bottom > other.top - 3)) continue;
      occupied.push(box); labels[point.id] = { x: left, y }; break;
    }
  }
  return labels;
}

export function FinanceChartTip({ title, children }) { return <><strong>{title}</strong><span>{children}</span></>; }

/** Axis/stage shorthand only; precise amounts stay in tooltips and evidence. */
export function financeChartMoney(value) { return value === null || value === undefined ? '—' : `RM ${new Intl.NumberFormat('en-MY', {notation:'compact',maximumFractionDigits:1}).format(value)}`; }
