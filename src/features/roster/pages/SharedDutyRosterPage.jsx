import DutyRosterPage from "../../sales-purchase/pages/DutyRosterPage.jsx";

// One Crew-owned runtime page. Legacy Restaurant hashes are canonicalized to
// this route before rendering; the domain and mutation authorities stay shared.
export default function SharedDutyRosterPage(props) {
  return <DutyRosterPage {...props} />;
}
