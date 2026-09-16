import FeedXDateRangePicker from "../../../components/ui/FeedXDateRangePicker.jsx";
import { todayInput } from "../utils/factoryDates.js";

export default function FactoryDateRangeFilter({ from, to, onApply }) {
  return <FeedXDateRangePicker from={from} to={to} today={todayInput()} onApply={onApply} />;
}

FactoryDateRangeFilter.adminFilterRole = "date-range";
