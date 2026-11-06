import { useEffect, useRef, useState } from 'react';

export default function useNetworkFullscreen(rootRef, { native = true } = {}) {
  const [fullscreen, setFullscreen] = useState(false), [notice, setNotice] = useState('');
  const nativeEntered = useRef(false), request = useRef(0);
  useEffect(() => {
    const changed = () => {
      if (document.fullscreenElement === rootRef.current) nativeEntered.current = true;
      else if (nativeEntered.current) { nativeEntered.current = false; setFullscreen(false); }
    };
    document.addEventListener('fullscreenchange', changed);
    return () => { request.current++; document.removeEventListener('fullscreenchange', changed); };
  }, [rootRef]);
  useEffect(() => {
    if (!fullscreen) return;
    const previousOverflow = document.body.style.overflow, siblings = [];
    for (let element = rootRef.current; element?.parentElement && element !== document.body; element = element.parentElement) {
      for (const sibling of element.parentElement.children) if (sibling !== element && !['SCRIPT', 'STYLE', 'LINK'].includes(sibling.tagName)) {
        siblings.push([sibling, sibling.inert]); sibling.inert = true;
      }
    }
    document.body.style.overflow = 'hidden';
    const escape = event => {
      if (event.key === 'Escape' && !event.defaultPrevented && !event.target.closest?.('[role="dialog"]') && !document.fullscreenElement) {
        event.preventDefault(); request.current++; setFullscreen(false); setNotice('');
      }
    };
    document.addEventListener('keydown', escape);
    return () => {
      document.body.style.overflow = previousOverflow;
      for (const [element, inert] of siblings) element.inert = inert;
      document.removeEventListener('keydown', escape);
    };
  }, [fullscreen, rootRef]);
  async function toggleFullscreen() {
    const generation = ++request.current;
    setNotice('');
    if (fullscreen) {
      if (document.fullscreenElement === rootRef.current) { try { await document.exitFullscreen(); } catch { /* Window mode can still be closed. */ } }
      setFullscreen(false);
      return;
    }
    setFullscreen(true);
    if (!native) return;
    try { await rootRef.current.requestFullscreen(); }
    catch { if (request.current === generation) setNotice('Canvas expanded to fill this window. Press Escape or Exit fullscreen to return.'); }
  }
  return { fullscreen, notice, toggleFullscreen };
}
