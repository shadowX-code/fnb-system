import React from 'react';
function itemInitials(item, category) {
  const source = item?.name || category?.name || "Item";
  return source
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0])
    .join("")
    .toUpperCase();
}

export default function InventoryItemThumbnail({ item, category, onPreview, size = "md" }) {
  const photo = item?.photo || item?.photo_url || "";
  const sizeClass = size === "sm" ? "h-10 w-10" : "h-12 w-12";
  const commonClass = `${sizeClass} shrink-0 overflow-hidden rounded-xl border border-border bg-slate-50`;

  if (photo) {
    return (
      <button
        className={`${commonClass} transition hover:border-primary/40 hover:shadow-sm focus:outline-none focus:ring-2 focus:ring-primary/25`}
        type="button"
        onClick={() => onPreview?.({ src: photo, title: item?.name || "Inventory item" })}
        title="View item photo"
        aria-label={`View photo for ${item?.name || "inventory item"}`}
      >
        <img className="h-full w-full object-cover" src={photo} alt={item?.name || "Inventory item"} />
      </button>
    );
  }

  return (
    <div className={`${commonClass} flex items-center justify-center text-[11px] font-black text-primary`} title="No photo uploaded">
      {itemInitials(item, category)}
    </div>
  );
}


