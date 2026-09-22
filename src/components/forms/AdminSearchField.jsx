import { Search } from "lucide-react";

/** Canonical labeled search control for AdminFilterToolbar consumers. */
export default function AdminSearchField({ label = "Search", value, onChange, placeholder = "Search", ariaLabel }) {
  return (
    <label className="admin-search-field">
      <span>{label}</span>
      <span className="admin-search-field-control">
        <Search aria-hidden="true" size={16} />
        <input
          aria-label={ariaLabel || label}
          className="control admin-search-field-input"
          type="search"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
        />
      </span>
    </label>
  );
}

AdminSearchField.adminFilterRole = "search";
