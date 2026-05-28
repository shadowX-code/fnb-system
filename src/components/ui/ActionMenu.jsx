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

  return (
    <span className="inline-flex" ref={triggerRef}>
      {trigger({ open, toggle: () => onOpenChange(!open), ariaLabel })}
      <FloatingLayer
        open={open}
        onOpenChange={onOpenChange}
        anchorRef={triggerRef}
        width={width}
        minWidth={width}
        align={align === "right" ? "end" : "start"}
        estimatedHeight={240}
        className="p-1.5 text-sm"
      >
        {children}
      </FloatingLayer>
    </span>
  );
}
