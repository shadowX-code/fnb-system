import { GripVertical } from "lucide-react";

/**
 * Shared native drag handle for ordered Admin builders. The parent owns the
 * collection and persistence; this control only supplies accessible intent.
 */
export default function AdminSortableHandle({
  label,
  scope,
  itemId,
  index,
  count,
  onMove,
  disabled = false,
}) {
  function onKeyDown(event) {
    if (disabled) return;
    if (event.key === "ArrowUp" && index > 0) {
      event.preventDefault();
      onMove(-1);
    }
    if (event.key === "ArrowDown" && index < count - 1) {
      event.preventDefault();
      onMove(1);
    }
  }

  return (
    <button
      className="admin-sortable-handle"
      type="button"
      aria-label={`${label}. Drag to reorder or use Arrow Up and Arrow Down.`}
      title="Drag to reorder. Use Arrow keys as a keyboard fallback."
      draggable={!disabled}
      disabled={disabled}
      onDragStart={(event) => {
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", JSON.stringify({ scope, itemId }));
      }}
      onKeyDown={onKeyDown}
    >
      <GripVertical size={16} aria-hidden="true" />
    </button>
  );
}
