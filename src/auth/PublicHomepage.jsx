import { useEffect } from "react";
import { FeedXVisualShell } from "./LoginPage.jsx";

export default function PublicHomepage() {
  useEffect(() => {
    if (window.location.pathname !== "/" || window.location.search || window.location.hash) {
      window.history.replaceState(null, "", "/");
    }
  }, []);

  return <FeedXVisualShell variant="public" />;
}
