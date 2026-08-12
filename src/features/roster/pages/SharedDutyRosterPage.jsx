import DutyRosterPage from "../../sales-purchase/pages/DutyRosterPage.jsx";

// One runtime page for both the Crew-owned route and the Restaurant
// compatibility entry. The domain services and mutation authorities remain
// shared; only the navigation ownership label differs.
export default function SharedDutyRosterPage(props) {
  return <DutyRosterPage {...props} />;
}
