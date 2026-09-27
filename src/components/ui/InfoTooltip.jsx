import { useId, useState } from 'react';
import { createPortal } from 'react-dom';

// Portal keeps table hints readable inside the canonical overflow container.
export default function InfoTooltip({ label, children }) {
  const id = useId();
  const [position, setPosition] = useState(null);
  const show = (event) => {
    const rect = event.currentTarget.getBoundingClientRect();
    setPosition({ left: Math.min(Math.max(rect.left + rect.width / 2, 132), window.innerWidth - 132), top: rect.bottom + 6 });
  };
  return <><button type="button" className="inline-flex items-center rounded p-1 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
    aria-label={label} aria-describedby={position ? id : undefined}
    onMouseEnter={show} onMouseLeave={() => setPosition(null)} onFocus={show} onBlur={() => setPosition(null)}
    onClick={show} onKeyDown={event => { if (event.key === 'Escape') setPosition(null); }}>
    {children}
  </button>{position && createPortal(<div id={id} role="tooltip" className="pointer-events-none fixed z-[100] w-64 -translate-x-1/2 whitespace-pre-line rounded-lg border border-border bg-surface p-3 text-xs text-text-primary shadow-lg"
    style={position}>{label}</div>, document.body)}</>;
}
