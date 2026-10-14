import { useRef } from "react";
import FloatingLayer from "./FloatingLayer.jsx";

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
  function setOpen(next) {
    onOpenChange(next);
    if (!next) triggerRef.current?.querySelector("button")?.focus();
  }
  function menuKey(event) {
    if (!["ArrowDown", "ArrowUp", "Home", "End", "Escape"].includes(event.key))
      return;
    event.preventDefault();
    event.stopPropagation();
    if (event.key === "Escape") {
      setOpen(false);
      return;
    }
    const items = [
      ...event.currentTarget.querySelectorAll(
        '[role="menuitem"]:not(:disabled)',
      ),
    ];
    const current = items.indexOf(document.activeElement);
    const next =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? items.length - 1
          : (current + (event.key === "ArrowDown" ? 1 : -1) + items.length) %
            items.length;
    items[next]?.focus();
  }

  return (
    <span className="inline-flex" ref={triggerRef}>
      {trigger({ open, toggle: () => setOpen(!open), ariaLabel })}
      <FloatingLayer
        focusOnOpen
        open={open}
        onOpenChange={setOpen}
        anchorRef={triggerRef}
        width={width}
        minWidth={width}
        align={align === "right" ? "end" : "start"}
        estimatedHeight={240}
        className="admin-action-menu p-1.5 text-sm"
      >
        <div onKeyDown={menuKey}>{children}</div>
      </FloatingLayer>
    </span>
  );
}
