import { lazy, Suspense, useSyncExternalStore } from "react";
import { isCrewHash } from "../features/crew/crewRoute.js";
import { isProductFeedbackPublicSurface, isPublicSurface } from "./hostnameRouting.js";
import WorkspaceBoundary from "./WorkspaceBoundary.jsx";

const AdminEntry = lazy(() => import("./AdminApp.jsx"));
const CrewEntry = lazy(() => import("./CrewEntry.jsx"));
const PublicHomepage = lazy(() => import("../auth/PublicHomepage.jsx"));
const FactoryProductFeedbackPublic = lazy(() => import("../features/factory/FactoryProductFeedbackPublic.jsx"));

function subscribe(listener) {
  window.addEventListener("hashchange", listener);
  window.addEventListener("popstate", listener);
  return () => {
    window.removeEventListener("hashchange", listener);
    window.removeEventListener("popstate", listener);
  };
}

const getWorkspace = () => isCrewHash() ? "crew" : "admin";

export default function App() {
  if (isProductFeedbackPublicSurface()) return <Suspense fallback={null}><FactoryProductFeedbackPublic /></Suspense>;
  if (isPublicSurface()) return <Suspense fallback={null}><PublicHomepage /></Suspense>;
  const workspace = useSyncExternalStore(subscribe, getWorkspace);
  // Internal routes retain their canonical route/session owners and lifetimes.
  return <WorkspaceBoundary key={workspace} workspace={workspace}>
    {workspace === "crew" ? <CrewEntry /> : <AdminEntry />}
  </WorkspaceBoundary>;
}
