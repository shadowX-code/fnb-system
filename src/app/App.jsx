import { lazy, useSyncExternalStore } from "react";
import { isCrewHash } from "../features/crew/crewRoute.js";
import WorkspaceBoundary from "./WorkspaceBoundary.jsx";

const AdminEntry = lazy(() => import("./AdminApp.jsx"));
const CrewEntry = lazy(() => import("./CrewEntry.jsx"));

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
  const workspace = useSyncExternalStore(subscribe, getWorkspace);
  // Internal routes retain their canonical route/session owners and lifetimes.
  return <WorkspaceBoundary key={workspace} workspace={workspace}>
    {workspace === "crew" ? <CrewEntry /> : <AdminEntry />}
  </WorkspaceBoundary>;
}
