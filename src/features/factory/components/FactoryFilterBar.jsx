import AdminFilterToolbar from "../../../components/layout/AdminFilterToolbar.jsx";

export default function FactoryFilterBar({ children, moreFilters, activeFilters = [], onClear, className = "" }) {
  return <AdminFilterToolbar className={className} moreFilters={moreFilters} activeFilters={activeFilters} onClear={onClear} sortChildren>{children}</AdminFilterToolbar>;
}
