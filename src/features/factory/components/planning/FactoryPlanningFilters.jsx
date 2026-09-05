import SearchableSelect from "../SearchableSelect.jsx";
import { Field, inputClass } from "../FactoryBulkSelectionModal.jsx";
import FactoryFilterBar from "../FactoryFilterBar.jsx";
import { planningCategoryOptions, planningStatusOptions } from "../../utils/factoryPlanningFormatters.js";

export default function FactoryPlanningFilters({ filters, onChange, categories, finishedGoods }) {
  const categoryOptions = planningCategoryOptions(categories, finishedGoods);
  const activeFilters = [
    filters.product && { key: "product", label: "Search", value: filters.product, onRemove: () => onChange({ product: "" }) },
    filters.status && { key: "status", label: "Status", value: filters.status, onRemove: () => onChange({ status: "" }) },
    filters.category && { key: "category", label: "Category", value: categoryOptions.find((option) => option.value === filters.category)?.label || filters.category, onRemove: () => onChange({ category: "" }) },
  ].filter(Boolean);

  return (
    <FactoryFilterBar
      activeFilters={activeFilters}
      onClear={() => onChange({ product: "", category: "", status: "" })}
    >
      <Field label="Search">
        <input className={inputClass()} value={filters.product} onChange={(event) => onChange({ product: event.target.value })} placeholder="Search product or SKU" />
      </Field>
      <Field label="Category">
        <SearchableSelect
          value={filters.category}
          options={[{ value: "", label: "All" }, ...categoryOptions]}
          placeholder="All"
          searchPlaceholder="Search categories"
          emptyText="No matching categories"
          onChange={(category) => onChange({ category })}
        />
      </Field>
      <Field label="Status">
        <SearchableSelect
          value={filters.status}
          options={planningStatusOptions}
          placeholder="All"
          searchPlaceholder="Search status"
          emptyText="No matching status"
          onChange={(status) => onChange({ status })}
        />
      </Field>
    </FactoryFilterBar>
  );
}
