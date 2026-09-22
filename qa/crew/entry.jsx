import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import CrewMobileApp from "../../src/features/crew/CrewMobileApp.jsx";
import CrewBottomSheet from "../../src/features/crew/components/CrewBottomSheet.jsx";
import CrewMobileModal from "../../src/features/crew/components/CrewMobileModal.jsx";
import { CrewHelpSheet } from "../../src/features/crew/components/CrewHelp.jsx";
import { CrewSectionHeader, CrewStatusBadge } from "../../src/features/crew/components/CrewMobileUI.jsx";
import i18n from "../../src/i18n/index.js";
import "../../src/styles/index.css";
import { session, longCopy } from "./fixtureService.js";

if (location.hostname !== "127.0.0.1" || !import.meta.env.DEV) throw new Error("Local renderer fixtures only.");
document.documentElement.dataset.resolvedTheme = "light";
await i18n.changeLanguage(new URLSearchParams(location.search).get("language") || "en");
localStorage.setItem("feedx.crew.session", JSON.stringify(session));

function Surfaces() {
  const [open, setOpen] = useState(null);
  const [nested, setNested] = useState(false);
  const Surface = open === "modal" ? CrewMobileModal : open === "help" ? CrewHelpSheet : CrewBottomSheet;
  return <main className="crew-v2-shell"><section className="crew-v2-app">
    <CrewSectionHeader title={longCopy()} meta={999} />
    <CrewStatusBadge tone="warning">{i18n.t("status.ready_for_review")}</CrewStatusBadge>
    {["sheet", "help", "modal"].map(kind => <button className="crew-mobile-primary" key={kind} onClick={() => setOpen(kind)}>{kind}</button>)}
    {open && <Surface title={longCopy()} onClose={() => setOpen(null)} footer={<button className="crew-mobile-primary" onClick={() => setNested(true)}>nested</button>}>
      <label className="crew-ui-form-field">QA input<input /></label>
      {Array.from({ length: 12 }, (_, index) => <p key={index}>{longCopy()}</p>)}
      <button className="crew-mobile-secondary" onClick={() => setNested(true)}>last action</button>
      {nested && <CrewBottomSheet title="Nested QA" onClose={() => setNested(false)}><button className="crew-mobile-secondary">nested action</button></CrewBottomSheet>}
    </Surface>}
  </section></main>;
}

createRoot(document.getElementById("root")).render(new URLSearchParams(location.search).has("surfaces") ? <Surfaces /> : <CrewMobileApp />);
