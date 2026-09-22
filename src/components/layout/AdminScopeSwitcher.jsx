import { useEffect, useRef } from "react";

/**
 * A direct scope switch is for a small, frequently changed set. Larger scopes
 * continue to use the searchable outlet selector in AdminFilterToolbar.
 */
export default function AdminScopeSwitcher({ ariaLabel = "Scope", items = [], value, onChange }) {
  const activeRef = useRef(null);

  useEffect(() => {
    activeRef.current?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
  }, [value]);

  const moveFocus = (event, index) => {
    if (!items.length || !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const target = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : (index + (event.key === "ArrowRight" ? 1 : -1) + items.length) % items.length;
    document.getElementById(`admin-scope-${items[target].id}`)?.focus();
  };

  return <div className="admin-scope-switcher" role="group" aria-label={ariaLabel}>
    <div className="admin-scope-switcher-rail">
      {items.map((item, index) => {
        const active = String(item.id) === String(value);
        return <button
          id={`admin-scope-${item.id}`}
          key={item.id}
          ref={active ? activeRef : null}
          type="button"
          className={active ? "is-active" : ""}
          aria-pressed={active}
          title={item.name}
          onClick={() => onChange(item.id)}
          onKeyDown={(event) => moveFocus(event, index)}
        >{item.name}</button>;
      })}
    </div>
  </div>;
}
