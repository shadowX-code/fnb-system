import { useEffect, useRef, useState } from "react";
import AdminSortableHandle from "./AdminSortableHandle.jsx";

/**
 * Shared ordered-builder interaction. Consumers retain their data authority;
 * this owner supplies native drag state, insertion feedback, and keyboard
 * movement through the same handle.
 */
export default function AdminSortableList({ items, getId = (item) => item.id, getLabel = (_item, index) => `Reorder item ${index + 1}`, onMove, className = "", children }) {
  const [drop, setDrop] = useState(null);
  const [pointerDrag, setPointerDrag] = useState(null);
  const listRef = useRef(null);

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
    if (event.button !== undefined && event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.focus();
    setDrop(null);
    setPointerDrag({ itemId, pointerId: event.pointerId, startY: event.clientY, offsetY: 0, moved: false });
  }

  useEffect(() => {
    if (!pointerDrag) return undefined;
    const onPointerMove = (event) => {
      if (event.pointerId !== pointerDrag.pointerId) return;
      event.preventDefault();
      const offsetY = event.clientY - pointerDrag.startY;
      if (Math.abs(offsetY) < 5) return;
      setPointerDrag((current) => current ? { ...current, offsetY, moved: true } : current);
      setDrop(pointerPlacement(event.clientY, pointerDrag.itemId));
      scrollNearPointer(event.clientY);
    };
    const complete = (event) => {
      if (event.pointerId !== pointerDrag.pointerId) return;
      const target = pointerPlacement(event.clientY, pointerDrag.itemId);
      if (pointerDrag.moved && target) onMove(pointerDrag.itemId, target.itemId, target.position);
      setDrop(null);
      setPointerDrag(null);
    };
    const cancel = (event) => {
      if (event.pointerId !== pointerDrag.pointerId) return;
      setDrop(null);
      setPointerDrag(null);
    };
    window.addEventListener("pointermove", onPointerMove, { passive: false });
    window.addEventListener("pointerup", complete);
    window.addEventListener("pointercancel", cancel);
    document.body.classList.add("admin-sortable-is-dragging");
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", complete);
      window.removeEventListener("pointercancel", cancel);
      document.body.classList.remove("admin-sortable-is-dragging");
    };
  }, [pointerDrag, onMove]);

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
              handle: <AdminSortableHandle label={getLabel(item, index)} index={index} count={items.length} dragging={dragging} onMove={(direction) => onMove(itemId, getId(items[index + direction]), direction < 0 ? "before" : "after")} onPointerDragStart={(event) => startPointerDrag(itemId, event)} />,
            })}
          </div>
        );
      })}
    </div>
  );
}
