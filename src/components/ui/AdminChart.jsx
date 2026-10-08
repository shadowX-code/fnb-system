import { createPortal } from 'react-dom';
import { createContext, useContext, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import './AdminChart.css';

const ChartContext = createContext(null);

/** A measured SVG canvas. Coordinates and type stay legible in narrow analytical columns. */
export function AdminChart({ label, height = 300, children, className = '', dataKey }) {
  const ref = useRef(null), tooltipId = useId();
  const [width, setWidth] = useState(640), [tip, setTip] = useState(null);
  useEffect(() => {
    if (!ref.current || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(([entry]) => { if (entry.contentRect.width > 0) setWidth(Math.max(240, Math.round(entry.contentRect.width))); });
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => setTip(null), [dataKey, width]);
  useEffect(() => {
    const focus = event => { if (!ref.current?.contains(event.target)) setTip(null); };
    document.addEventListener('focusin', focus);
    return () => document.removeEventListener('focusin', focus);
  }, []);
  useEffect(() => {
    const dismiss = () => setTip(null);
    window.addEventListener('scroll', dismiss, true);
    window.addEventListener('resize', dismiss);
    return () => { window.removeEventListener('scroll', dismiss, true); window.removeEventListener('resize', dismiss); };
  }, []);
  const show = (element, content, owner, anchor, interaction) => {
    // Layout/scroll can put another mark beneath a stationary pointer. Keyboard inspection keeps authority.
    const focused = document.activeElement;
    if (interaction === 'pointer' && focused !== element && focused?.matches('[data-admin-chart-mark][data-keyboard-focus=true],[data-admin-chart-inspection]')) return false;
    const host = ref.current.getBoundingClientRect();
    const svg = element.ownerSVGElement, scale = host.width / Number(svg?.getAttribute('viewBox')?.split(' ')[2] || host.width || 1);
    const mark = anchor ? {left:host.left+anchor.x*scale,top:host.top+anchor.y*scale,bottom:host.top+anchor.y*scale,width:0} : element.getBoundingClientRect();
    setTip({content, owner, anchor:{x:mark.left+mark.width/2,top:anchor ? mark.top : (mark.top+mark.bottom)/2,bottom:anchor ? mark.bottom : (mark.top+mark.bottom)/2}});
    return true;
  };
  return <ChartContext.Provider value={{ show, hide: owner => setTip(current => !owner || current?.owner === owner ? null : current), tooltipId, owner: tip?.owner }}><div ref={ref} className={`admin-chart ${className}`} onKeyDown={e => { if (e.key === 'Escape') setTip(null); }}>
    <svg viewBox={`0 0 ${width} ${typeof height === 'function' ? height(width) : height}`} role="group" aria-label={label}>{children(width, height)}</svg>
    {tip ? <AdminChartFloatingTooltip id={tooltipId} anchor={tip.anchor}>{tip.content}</AdminChartFloatingTooltip> : null}
  </div></ChartContext.Provider>;
}

/** Pointer, keyboard and touch all select the same canonical object and context. */
export function AdminChartMark({ label, tooltip, selected, dimmed, onSelect, onInspect, tooltipAnchor, children, className = '', ...geometry }) {
  const chart = useContext(ChartContext), owner = useId();
  const [keyboard, setKeyboard] = useState(true);
  return <g {...geometry} data-admin-chart-mark="true" data-keyboard-focus={keyboard ? "true" : "false"} role="button" tabIndex={0} aria-label={label} aria-pressed={Boolean(selected)} aria-describedby={chart.owner === owner ? chart.tooltipId : undefined}
    className={`admin-chart-mark ${selected ? 'is-selected' : ''} ${dimmed ? 'is-receded' : ''} ${className}`}
    onPointerDown={() => setKeyboard(false)}
    onPointerEnter={e => { if (chart.show(e.currentTarget, tooltip, owner, tooltipAnchor, 'pointer')) onInspect?.(true); }} onPointerLeave={e => { if (e.pointerType !== 'touch' && (document.activeElement !== e.currentTarget || !keyboard) && chart.owner === owner) { chart.hide(owner); onInspect?.(false); } }}
    onFocus={e => { chart.show(e.currentTarget, tooltip, owner, tooltipAnchor); onInspect?.(true); }} onBlur={() => { setKeyboard(true); chart.hide(owner); onInspect?.(false); }}
    onClick={e => { onSelect(); chart.show(e.currentTarget, tooltip, owner, tooltipAnchor); }}
    onKeyDown={e => {
      setKeyboard(true);
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


/** Rounded quantitative ticks. Amount encodings include zero; level markers may use an explicit focused range. */
export function adminChartScale(values, intervals = 4, {includeZero = true} = {}) {
  const finite = values.filter(Number.isFinite);
  const extent = finite.length ? finite : [0,1];
  const padding = includeZero ? 0 : (Math.max(...extent)-Math.min(...extent) || Math.max(1,Math.abs(extent[0])*.02))*.15;
  const low = includeZero ? Math.min(0,...extent) : Math.min(...extent)-padding;
  const high = includeZero ? Math.max(0,...extent) : Math.max(...extent)+padding;
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

/** Shared exact-value inspection anatomy; domain adapters own values, units and evidence. */
export function AdminChartTooltipContent({title, rows, note, children}) {
  return <><strong className="admin-chart-tooltip-title">{title}</strong>{rows?.map(row=><div className="admin-chart-tooltip-row" key={row.label}><span><i aria-hidden="true" style={{background:row.color}}/>{row.label}</span><b>{row.value}</b></div>)}{children?<span>{children}</span>:null}{note?<small className="admin-chart-tooltip-note">{note}</small>:null}</>;
}

/** Current values sit above their true coordinates; callers manage collisions. */
export function AdminChartValueLabel({x,y,value,color}) {
  const width=value.length*6.5+16;
  return <g aria-hidden="true" pointerEvents="none" className="admin-chart-value-label"><rect x={x-width} y={y-18} width={width} height="23" rx="4" fill={color}/><text x={x-8} y={y-3} textAnchor="end">{value}</text></g>;
}

/** Measured floating inspection stays within the viewport at every edge. */
export function adminChartTooltipPosition(anchor, box, viewport) {
  const gutter = 8;
  const x = Math.max(gutter, Math.min(viewport.width-box.width-gutter, anchor.x-box.width/2));
  const above = anchor.top-box.height-gutter;
  const y = Math.max(gutter, Math.min(viewport.height-box.height-gutter, above >= gutter ? above : anchor.bottom+gutter));
  return {x,y};
}

/** One floating inspection owner for full charts and miniature trends. */
export function AdminChartFloatingTooltip({id, anchor, children}) {
  const ref = useRef(null), [position,setPosition] = useState({x:8,y:8});
  useLayoutEffect(() => {
    const box = ref.current.getBoundingClientRect();
    const next = adminChartTooltipPosition(anchor,box,{width:window.innerWidth,height:window.innerHeight});
    setPosition(current => current.x === next.x && current.y === next.y ? current : next);
  }, [anchor,children]);
  return createPortal(<div ref={ref} id={id} role="tooltip" className="admin-chart-tooltip" style={{left:position.x,top:position.y}}>{children}</div>,document.body);
}
