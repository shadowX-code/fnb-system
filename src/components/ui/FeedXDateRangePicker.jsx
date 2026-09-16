// Shared public entry point. The implementation remains colocated with its
// first consumer while other FeedX modules migrate to this common API.
import "./FeedXDateRangePicker.css";
import CrewAttendanceDateRangePicker, { rangeLabel } from "../../features/crew/components/CrewAttendanceDateRangePicker.jsx";

function FeedXDateRangePicker(props) {
  return <CrewAttendanceDateRangePicker {...props} />;
}

FeedXDateRangePicker.adminFilterRole = "date-range";

export { rangeLabel };
export default FeedXDateRangePicker;
