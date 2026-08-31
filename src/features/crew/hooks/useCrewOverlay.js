import { useLayoutEffect, useRef } from "react";

// Shared by Crew modal and sheet surfaces. Only the top surface owns keyboard
// focus; nested surfaces keep the page locked until the last surface closes.
const overlays = [];
let pageLock;
const focusableSelector = "button, [href], input, select, textarea, [tabindex]:not([tabindex='-1'])";

export default function useCrewOverlay({ onClose, closeDisabled, initialFocusRef }) {
  const surfaceRef = useRef(null);
  const closeRef = useRef(null);
  const latest = useRef(null);
  latest.current = { onClose, closeDisabled, initialFocusRef };

  useLayoutEffect(() => {
    const surface = surfaceRef.current;
    if (!surface) return undefined;
    const previousFocus = document.activeElement;
    if (!overlays.length) {
      pageLock = { scrollY: window.scrollY, styles: { overflow: document.body.style.overflow, position: document.body.style.position, top: document.body.style.top, width: document.body.style.width } };
      Object.assign(document.body.style, { overflow: "hidden", position: "fixed", top: `-${pageLock.scrollY}px`, width: "100%" });
    }
    overlays.push(surface);
    const isTop = () => overlays.at(-1) === surface;
    const focusable = () => [...surface.querySelectorAll(focusableSelector)].filter((element) => !element.disabled && element.tabIndex >= 0 && !element.closest("[hidden], [inert], [aria-hidden='true']") && getComputedStyle(element).display !== "none" && getComputedStyle(element).visibility !== "hidden");
    const focusInitial = () => {
      const preferred = latest.current.initialFocusRef?.current || closeRef.current;
      (preferred && !preferred.disabled ? preferred : focusable()[0] || surface).focus();
    };
    focusInitial();
    const onKeyDown = (event) => {
      if (!isTop()) return;
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopImmediatePropagation();
        if (!latest.current.closeDisabled) latest.current.onClose();
      }
      if (event.key !== "Tab") return;
      const items = focusable();
      if (!items.length) { event.preventDefault(); surface.focus(); return; }
      const first = items[0];
      const last = items.at(-1);
      if (!surface.contains(document.activeElement) || document.activeElement === surface || (event.shiftKey ? document.activeElement === first : document.activeElement === last)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      }
    };
    const onFocusIn = (event) => { if (isTop() && !surface.contains(event.target)) focusInitial(); };
    document.addEventListener("keydown", onKeyDown, true);
    document.addEventListener("focusin", onFocusIn);
    return () => {
      const wasTop = isTop();
      overlays.splice(overlays.indexOf(surface), 1);
      document.removeEventListener("keydown", onKeyDown, true);
      document.removeEventListener("focusin", onFocusIn);
      if (!overlays.length) {
        Object.assign(document.body.style, pageLock.styles);
        if (pageLock.scrollY) window.scrollTo(0, pageLock.scrollY);
        pageLock = null;
      }
      if (wasTop && previousFocus?.isConnected) previousFocus.focus?.();
    };
  }, []);

  return { surfaceRef, closeRef };
}
