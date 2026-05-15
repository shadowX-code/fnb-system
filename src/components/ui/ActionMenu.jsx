import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

export default function ActionMenu({
  open,
  onOpenChange,
  trigger,
  children,
  width = 208,
  align = "right",
  ariaLabel = "Actions",
}) {
  const triggerRef = useRef(null);
  const menuRef = useRef(null);
  const [position, setPosition] = useState({ top: 0, left: 0, placement: "bottom", ready: false });

  function updatePosition() {
    const triggerNode = triggerRef.current;
    if (!triggerNode) return;

    const rect = triggerNode.getBoundingClientRect();
    const menuHeight = menuRef.current?.offsetHeight || 240;
    const gap = 8;
    const margin = 12;
    const spaceBelow = window.innerHeight - rect.bottom - margin;
    const spaceAbove = rect.top - margin;
    const placement = spaceBelow < menuHeight + gap && spaceAbove > spaceBelow ? "top" : "bottom";
    const rawTop = placement === "top" ? rect.top - menuHeight - gap : rect.bottom + gap;
    const rawLeft = align === "right" ? rect.right - width : rect.left;

    setPosition({
      top: clamp(rawTop, margin, Math.max(margin, window.innerHeight - menuHeight - margin)),
      left: clamp(rawLeft, margin, Math.max(margin, window.innerWidth - width - margin)),
      placement,
      ready: true,
    });
  }

  useLayoutEffect(() => {
    if (!open) return undefined;
    updatePosition();
    const frame = window.requestAnimationFrame(updatePosition);
    return () => window.cancelAnimationFrame(frame);
  }, [open, width, align]);

  useEffect(() => {
    if (!open) return undefined;

    function handlePointerDown(event) {
      if (triggerRef.current?.contains(event.target) || menuRef.current?.contains(event.target)) return;
      onOpenChange(false);
    }

    function handleKeyDown(event) {
      if (event.key === "Escape") onOpenChange(false);
    }

    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open, onOpenChange]);

  return (
    <span className="inline-flex" ref={triggerRef}>
      {trigger({ open, toggle: () => onOpenChange(!open), ariaLabel })}
      {open
        ? createPortal(
            <div
              ref={menuRef}
              className={`fixed z-[80] rounded-2xl border border-border bg-surface p-1.5 text-sm shadow-xl transition duration-150 ${
                position.ready ? "translate-y-0 opacity-100" : "translate-y-1 opacity-0"
              }`}
              style={{ top: position.top, left: position.left, width }}
              data-placement={position.placement}
            >
              {children}
            </div>,
            document.body,
          )
        : null}
    </span>
  );
}
