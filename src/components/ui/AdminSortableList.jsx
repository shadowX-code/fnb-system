import { useState } from "react";
import AdminSortableHandle from "./AdminSortableHandle.jsx";

/**
 * Shared ordered-builder interaction. Consumers retain their data authority;
 * this owner supplies native drag state, insertion feedback, and keyboard
 * movement through the same handle.
 */
export default function AdminSortableList({ items, scope, getId = (item) => item.id, getLabel = (_item, index) => `Reorder item ${index + 1}`, onMove, className = "", children }) {
  const [dragId, setDragId] = useState("");
  const [drop, setDrop] = useState(null);

  function placement(event, itemId) {
    const box = event.currentTarget.getBoundingClientRect();
    return { itemId, position: event.clientY < box.top + box.height / 2 ? "before" : "after" };
  }

  function finish(itemId, event) {
    event.preventDefault();
    if (!dragId || dragId === itemId) return;
    const next = placement(event, itemId);
    onMove(dragId, next.itemId, next.position);
    setDrop(null);
    setDragId("");
  }

  return (
    <div className={`admin-sortable-list ${className}`.trim()} data-sortable-active={dragId ? "true" : undefined}>
      {items.map((item, index) => {
        const itemId = getId(item);
        const dragging = dragId === itemId;
        const isDropTarget = drop?.itemId === itemId && !dragging;
        return (
          <div
            key={itemId}
            className="admin-sortable-list-row"
            data-dragging={dragging || undefined}
            data-drop-position={isDropTarget ? drop.position : undefined}
            onDragOver={(event) => {
              if (!dragId || dragId === itemId) return;
              event.preventDefault();
              event.dataTransfer.dropEffect = "move";
              setDrop(placement(event, itemId));
            }}
            onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setDrop((current) => current?.itemId === itemId ? null : current); }}
            onDrop={(event) => finish(itemId, event)}
          >
            {children({
              item,
              index,
              dragging,
              handle: <AdminSortableHandle label={getLabel(item, index)} scope={scope} itemId={itemId} index={index} count={items.length} onMove={(direction) => onMove(itemId, items[index + direction]?.id, direction < 0 ? "before" : "after")} onDragStateChange={(active) => { setDragId(active ? itemId : ""); if (!active) setDrop(null); }} />,
            })}
          </div>
        );
      })}
    </div>
  );
}
