import { lazy, Suspense, useEffect, useSyncExternalStore } from "react";
import { crewRouteUrlForLegacyHash, crewWorkspaceForLocation } from "../features/crew/crewRoute.js";
import { isCrewWebAppSurface, isProductFeedbackPublicSurface, isPublicSurface } from "./hostnameRouting.js";
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

const getWorkspace = () => crewWorkspaceForLocation(window.location);

function CrewWebAppMetadata() {
  useEffect(() => {
    const entries = [
      ["link", "manifest", "/crew.webmanifest"],
      ["link", "apple-touch-icon", "/logo-icon.jpg"],
      ["meta", "theme-color", "#0f766e"],
      ["meta", "apple-mobile-web-app-capable", "yes"],
      ["meta", "apple-mobile-web-app-status-bar-style", "default"],
      ["meta", "apple-mobile-web-app-title", "FeedX Crew"],
    ].map(([tagName, key, value]) => {
      const element = document.createElement(tagName);
      if (tagName === "link") {
        element.setAttribute("rel", key);
        element.setAttribute("href", value);
      } else {
        element.setAttribute("name", key);
        element.setAttribute("content", value);
      }
      element.dataset.feedxCrewWebApp = key;
      document.head.append(element);
      return element;
    });
    return () => entries.forEach((entry) => entry.remove());
  }, []);
  return null;
}

function LegacyCrewRedirect() {
  useEffect(() => {
    const destination = crewRouteUrlForLegacyHash();
    if (destination) window.location.replace(destination);
  }, []);
  return <main aria-live="polite" aria-label="Opening FeedX Crew" />;
}

export default function App() {
  if (isProductFeedbackPublicSurface()) return <Suspense fallback={null}><FactoryProductFeedbackPublic /></Suspense>;
  if (isPublicSurface()) return <Suspense fallback={null}><PublicHomepage /></Suspense>;
  const workspace = useSyncExternalStore(subscribe, getWorkspace);
  if (workspace === "legacy-crew-redirect") return <LegacyCrewRedirect />;
  // Internal routes retain their canonical route/session owners and lifetimes.
  return <>
    {workspace === "crew" && isCrewWebAppSurface() ? <CrewWebAppMetadata /> : null}
    <WorkspaceBoundary key={workspace} workspace={workspace}>
      {workspace === "crew" ? <CrewEntry /> : <AdminEntry />}
    </WorkspaceBoundary>
  </>;
}
