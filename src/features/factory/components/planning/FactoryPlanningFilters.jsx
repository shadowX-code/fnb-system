import SearchableSelect from "../SearchableSelect.jsx";
import { Field, inputClass } from "../FactoryBulkSelectionModal.jsx";
import { planningCategoryOptions, planningStatusOptions } from "../../utils/factoryPlanningFormatters.js";

export default function FactoryPlanningFilters({ filters, onChange, categories, finishedGoods }) {
  const categoryOptions = planningCategoryOptions(categories, finishedGoods);

  return (
    <div className="grid gap-3 rounded-2xl border border-border bg-white p-4 md:grid-cols-3">
      <Field label="Product">
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
    </div>
  );
}
