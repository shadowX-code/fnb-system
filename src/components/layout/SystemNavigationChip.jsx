import { Bot, Share2 } from 'lucide-react';
import './SystemNavigationChip.css';

/** Shared Admin system destinations; motion is presentation, never service status. */
export default function SystemNavigationChip({ kind, active, live, onClick }) {
  const network = kind === 'network';
  const Icon = network ? Share2 : Bot;
  return <button type="button" className="system-nav-chip" data-kind={kind}
    aria-current={active ? 'page' : undefined} onClick={onClick}>
    <span className="system-nav-chip__icon" aria-hidden="true"><Icon size={17}/></span>
    {network ? <><span className="system-nav-chip__label">Smart Operations Network</span>{live && <span className="system-nav-chip__status"><i aria-hidden="true"/>Live</span>}</>
      : <span className="system-nav-chip__label">AI Assistant</span>}
  </button>;
}
