import FilterBar from "../../../components/forms/FilterBar.jsx";
import { MonthSelector, OutletSelector, YearSelector } from "../../../components/forms/Selectors.jsx";

export default function PeriodFilterBar({ store, filters, actions, compact = false }) {
  return (
    <FilterBar actions={actions} compact={compact}>
      <OutletSelector outlets={store.outlets} value={filters.outletId} onChange={filters.setOutletId} />
      <MonthSelector value={filters.month} onChange={filters.setMonth} />
      <YearSelector value={filters.year} onChange={filters.setYear} />
    </FilterBar>
  );
}
