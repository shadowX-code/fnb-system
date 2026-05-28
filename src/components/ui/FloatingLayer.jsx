import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function getAnchorRect(anchorRef) {
  const node = anchorRef?.current;
  return node?.getBoundingClientRect?.() ?? null;
}

export default function FloatingLayer({
  open,
  onOpenChange,
  anchorRef,
  anchorRect,
  children,
  align = "end",
  offset = 8,
  width,
  minWidth = 224,
  maxHeight,
  estimatedHeight = 260,
  placement = "auto",
  className = "",
  contentClassName = "",
  closeOnOutsideClick = true,
  closeOnEscape = true,
  focusOnOpen = false,
  mobileSheet = false,
  layer = "popover",
}) {
  const layerRef = useRef(null);
  const [position, setPosition] = useState({ top: 0, left: 0, width: minWidth, maxHeight: 320, placement: "bottom", ready: false });
  const zClass = layer === "tooltip" ? "z-tooltip-layer" : layer === "lightbox" ? "z-lightbox-layer" : "z-popover-layer";

  function close() {
    onOpenChange?.(false);
  }

  function updatePosition() {
    const rect = anchorRect || getAnchorRect(anchorRef);
    if (!rect) return;

    const margin = 12;
    const viewportHeight = window.innerHeight;
    const viewportWidth = window.innerWidth;
    const measuredHeight = layerRef.current?.offsetHeight || estimatedHeight;
    const layerWidth = Math.max(width || rect.width || minWidth, minWidth);
    const availableMaxHeight = Math.max(160, viewportHeight - margin * 2);
    const nextMaxHeight = maxHeight ? Math.min(maxHeight, availableMaxHeight) : availableMaxHeight;
    const effectiveHeight = Math.min(measuredHeight, nextMaxHeight);
    const spaceBelow = viewportHeight - rect.bottom - margin;
    const spaceAbove = rect.top - margin;
    const shouldFlip = placement === "top" || (placement === "auto" && spaceBelow < effectiveHeight + offset && spaceAbove > spaceBelow);
    const rawTop = shouldFlip ? rect.top - effectiveHeight - offset : rect.bottom + offset;

    let rawLeft = rect.left;
    if (align === "center") rawLeft = rect.left + rect.width / 2 - layerWidth / 2;
    if (align === "end" || align === "right") rawLeft = rect.right - layerWidth;

    setPosition({
      top: clamp(rawTop, margin, Math.max(margin, viewportHeight - effectiveHeight - margin)),
      left: clamp(rawLeft, margin, Math.max(margin, viewportWidth - layerWidth - margin)),
      width: layerWidth,
      maxHeight: nextMaxHeight,
      placement: shouldFlip ? "top" : "bottom",
      ready: true,
    });
  }

  useLayoutEffect(() => {
    if (!open) return undefined;
    updatePosition();
    const frame = window.requestAnimationFrame(updatePosition);
    return () => window.cancelAnimationFrame(frame);
  }, [open, align, offset, width, minWidth, maxHeight, estimatedHeight, placement, anchorRect]);

  useEffect(() => {
    if (!open) return undefined;

    function handlePointerDown(event) {
      if (!closeOnOutsideClick) return;
      if (anchorRef?.current?.contains(event.target) || layerRef.current?.contains(event.target)) return;
      close();
    }

    function handleKeyDown(event) {
      if (event.key === "Escape" && closeOnEscape) close();
    }

    function handleFocus() {
      if (!focusOnOpen) return;
      const target = layerRef.current?.querySelector("input, button, [href], select, textarea, [tabindex]:not([tabindex='-1'])");
      target?.focus?.();
    }

    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    const focusFrame = window.requestAnimationFrame(handleFocus);

    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
      window.cancelAnimationFrame(focusFrame);
    };
  }, [open, closeOnOutsideClick, closeOnEscape, focusOnOpen, onOpenChange]);

  if (!open) return null;

  return createPortal(
    <div
      ref={layerRef}
      className={`fixed ${zClass} overflow-y-auto overscroll-contain rounded-2xl border border-border bg-surface shadow-xl ring-1 ring-slate-900/5 transition duration-150 ${
        position.ready ? "translate-y-0 opacity-100" : "translate-y-1 opacity-0"
      } p-2 ${mobileSheet ? "max-h-[78vh]" : ""} ${className}`}
      style={{ top: position.top, left: position.left, width: position.width, maxHeight: position.maxHeight }}
      data-placement={position.placement}
    >
      <div
        className={contentClassName}
        style={{ maxHeight: position.maxHeight }}
      >
        {children}
      </div>
    </div>,
    document.body,
  );
}
