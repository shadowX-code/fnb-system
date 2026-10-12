import SelectField from "../../../components/forms/SelectField.jsx";

/** Compatibility adapter; shared SelectField owns all dropdown presentation and interaction. */
export default function SearchableSelect({ value, options = [], placeholder, onChange, error, searchPlaceholder = "Search", emptyText = "No matching options", disabled = false, buttonRef, searchable = "auto", ariaLabel }) {
  return <SelectField value={value} options={options.map(option => ({ ...option, description: option.description || option.helper }))} placeholder={placeholder} onChange={onChange} error={error} disabled={disabled} buttonRef={buttonRef} searchable={searchable} searchPlaceholder={searchPlaceholder} emptyText={emptyText} ariaLabel={ariaLabel} />;
}

SearchableSelect.adminFilterRole = "filter";
