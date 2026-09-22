import { useEffect, useRef, useState } from "react";
import AdminSortableHandle from "./AdminSortableHandle.jsx";

/**
 * Shared ordered-builder interaction. Consumers retain their data authority;
 * this owner supplies pointer drag state, insertion feedback, and keyboard
 * movement through the same handle.
 */
export default function AdminSortableList({ items, getId = (item) => item.id, getLabel = (_item, index) => `Reorder item ${index + 1}`, onMove, className = "", children }) {
  const [drop, setDrop] = useState(null);
  const [pointerDrag, setPointerDrag] = useState(null);
  const listRef = useRef(null);
  const pointerDragRef = useRef(null);
  const removePointerListenersRef = useRef(() => {});
  const onMoveRef = useRef(onMove);

  onMoveRef.current = onMove;

  const activeDragId = pointerDrag?.itemId || "";

  function pointerPlacement(clientY, itemId) {
    const rows = [...(listRef.current?.querySelectorAll("[data-sortable-item-id]") || [])]
      .filter((row) => row.dataset.sortableItemId !== itemId);
    if (!rows.length) return null;
    const closest = rows.reduce((current, row) => {
      const box = row.getBoundingClientRect();
      const distance = Math.abs(clientY - (box.top + box.height / 2));
      return !current || distance < current.distance ? { row, box, distance } : current;
    }, null);
    return {
      itemId: closest.row.dataset.sortableItemId,
      position: clientY < closest.box.top + closest.box.height / 2 ? "before" : "after",
    };
  }

  function scrollNearPointer(clientY) {
    let container = listRef.current;
    while (container) {
      const style = window.getComputedStyle(container);
      if (/(auto|scroll)/.test(style.overflowY) && container.scrollHeight > container.clientHeight) {
        const box = container.getBoundingClientRect();
        if (clientY < box.top + 44) container.scrollBy({ top: -14, behavior: "auto" });
        if (clientY > box.bottom - 44) container.scrollBy({ top: 14, behavior: "auto" });
        return;
      }
      container = container.parentElement;
    }
    if (clientY < 44) window.scrollBy({ top: -14, behavior: "auto" });
    if (clientY > window.innerHeight - 44) window.scrollBy({ top: 14, behavior: "auto" });
  }

  function startPointerDrag(itemId, event) {
    if (pointerDragRef.current) return;
    if (event.button !== undefined && event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.focus();
    const isPointer = event.type.startsWith("pointer");
    const inputId = isPointer ? event.pointerId : "mouse";
    event.currentTarget.setPointerCapture?.(event.pointerId);
    setDrop(null);
    const initial = { itemId, inputId, startY: event.clientY, offsetY: 0, moved: false };
    pointerDragRef.current = initial;
    setPointerDrag(initial);
    document.body.classList.add("admin-sortable-is-dragging");

    const clear = () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", complete);
      window.removeEventListener("pointercancel", cancel);
      window.removeEventListener("mousemove", onPointerMove);
      window.removeEventListener("mouseup", complete);
      removePointerListenersRef.current = () => {};
      document.body.classList.remove("admin-sortable-is-dragging");
    };
    const onPointerMove = (moveEvent) => {
      const current = pointerDragRef.current;
      if (!current || (isPointer && moveEvent.pointerId !== current.inputId)) return;
      moveEvent.preventDefault();
      const offsetY = moveEvent.clientY - current.startY;
      if (Math.abs(offsetY) < 5) return;
      const next = { ...current, offsetY, moved: true };
      pointerDragRef.current = next;
      setPointerDrag(next);
      setDrop(pointerPlacement(moveEvent.clientY, current.itemId));
      scrollNearPointer(moveEvent.clientY);
    };
    const complete = (upEvent) => {
      const current = pointerDragRef.current;
      if (!current || (isPointer && upEvent.pointerId !== current.inputId)) return;
      const target = pointerPlacement(upEvent.clientY, current.itemId);
      if (current.moved && target) onMoveRef.current(current.itemId, target.itemId, target.position);
      pointerDragRef.current = null;
      setDrop(null);
      setPointerDrag(null);
      clear();
    };
    const cancel = (cancelEvent) => {
      const current = pointerDragRef.current;
      if (!current || (isPointer && cancelEvent.pointerId !== current.inputId)) return;
      pointerDragRef.current = null;
      setDrop(null);
      setPointerDrag(null);
      clear();
    };
    removePointerListenersRef.current();
    removePointerListenersRef.current = clear;
    if (isPointer) {
      window.addEventListener("pointermove", onPointerMove, { passive: false });
      window.addEventListener("pointerup", complete);
      window.addEventListener("pointercancel", cancel);
    } else {
      window.addEventListener("mousemove", onPointerMove, { passive: false });
      window.addEventListener("mouseup", complete);
    }
  }

  useEffect(() => {
    return () => removePointerListenersRef.current();
  }, []);

  return (
    <div ref={listRef} className={`admin-sortable-list ${className}`.trim()} data-sortable-active={activeDragId ? "true" : undefined}>
      {items.map((item, index) => {
        const itemId = getId(item);
        const dragging = activeDragId === itemId;
        const isDropTarget = drop?.itemId === itemId && !dragging;
        return (
          <div
            key={itemId}
            className="admin-sortable-list-row"
            data-sortable-item-id={itemId}
            data-dragging={dragging || undefined}
            data-drop-position={isDropTarget ? drop.position : undefined}
            style={pointerDrag?.itemId === itemId ? { transform: `translateY(${pointerDrag.offsetY}px)`, zIndex: 3 } : undefined}
          >
            {children({
              item,
              index,
              dragging,
              handle: <AdminSortableHandle label={getLabel(item, index)} index={index} count={items.length} dragging={dragging} onMove={(direction) => onMove(itemId, getId(items[index + direction]), direction < 0 ? "before" : "after")} onPointerDragStart={(event) => startPointerDrag(itemId, event)} onMouseDragStart={(event) => startPointerDrag(itemId, event)} />,
            })}
          </div>
        );
      })}
    </div>
  );
}
