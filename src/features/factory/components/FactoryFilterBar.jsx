import { Children, isValidElement } from "react";
import AdminFilterToolbar from "../../../components/layout/AdminFilterToolbar.jsx";
import FactoryDateRangeFilter from "./FactoryDateRangeFilter.jsx";

function labelOf(field) {
  return String(isValidElement(field) ? field.props.label || "" : "").toLowerCase();
}

function canonicalizeDateRange(children) {
  const fields = Children.toArray(children);
  return fields.reduce((result, field, index) => {
    const next = fields[index + 1];
    if (labelOf(field) === "date" && labelOf(next) === "to") {
      const fromControl = field.props.children;
      const toControl = next.props.children;
      if (isValidElement(fromControl) && isValidElement(toControl) && typeof fromControl.props.onChange === "function" && typeof toControl.props.onChange === "function") {
        result.push(<FactoryDateRangeFilter key="date-range" from={fromControl.props.value} to={toControl.props.value} onApply={({ from, to }) => { fromControl.props.onChange(from); toControl.props.onChange(to); }} />);
        return result;
      }
    }
    if (labelOf(field) !== "to" || labelOf(fields[index - 1]) !== "date") result.push(field);
    return result;
  }, []);
}

export default function FactoryFilterBar({ children, moreFilters, activeFilters = [], onClear, className = "" }) {
  return <AdminFilterToolbar className={className} moreFilters={moreFilters} activeFilters={activeFilters} onClear={onClear} sortChildren>{canonicalizeDateRange(children)}</AdminFilterToolbar>;
}
