/**
 * Entry point for the single-file demo (see build.mjs).
 *
 * Renders the same operator layout and pages as the Next.js app, picking the
 * page from the URL hash. All data comes from the in-browser fake backend.
 */
import { StrictMode, useEffect, useState, type ComponentType } from "react";
import { createRoot } from "react-dom/client";
import { LocationContext, readHash, type HashLocation } from "./navigation";

import OperatorLayout from "@/app/operator/layout";
import Dashboard from "@/app/operator/page";
import Inbox from "@/app/operator/inbox/page";
import Tasks from "@/app/operator/tasks/page";
import Messages from "@/app/operator/messages/page";
import Search from "@/app/operator/search/page";
import Jobs from "@/app/operator/jobs/page";
import JobDetail from "@/app/operator/jobs/[id]/page";
import Candidate from "@/app/operator/candidates/[candidateId]/page";
import Contacts from "@/app/operator/contacts/page";
import Review from "@/app/operator/review/page";
import Settings from "@/app/operator/settings/page";
import Login from "@/app/operator/login/page";

const ROUTES: Array<[string, ComponentType<any>]> = [
  ["/operator", Dashboard],
  ["/operator/inbox", Inbox],
  ["/operator/tasks", Tasks],
  ["/operator/messages", Messages],
  ["/operator/search", Search],
  ["/operator/jobs", Jobs],
  ["/operator/jobs/:id", JobDetail],
  ["/operator/candidates/:candidateId", Candidate],
  ["/operator/contacts", Contacts],
  ["/operator/review", Review],
  ["/operator/settings", Settings],
  ["/operator/login", Login],
];

function match(pathname: string): { Page: ComponentType<any>; params: Record<string, string> } {
  const parts = pathname.replace(/\/+$/, "").split("/");
  for (const [pattern, Page] of ROUTES) {
    const p = pattern.split("/");
    if (p.length !== parts.length) continue;
    const params: Record<string, string> = {};
    if (p.every((seg, i) => (seg.startsWith(":") ? ((params[seg.slice(1)] = decodeURIComponent(parts[i])), true) : seg === parts[i]))) {
      return { Page, params };
    }
  }
  return { Page: Dashboard, params: {} };
}

function App() {
  const [loc, setLoc] = useState(readHash);
  useEffect(() => {
    const onChange = () => setLoc(readHash());
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);

  const { Page, params } = match(loc.pathname);
  const value: HashLocation = { ...loc, params };

  return (
    <LocationContext.Provider value={value}>
      <OperatorLayout>
        {/* key remounts the page on navigation, as Next.js does */}
        <Page key={loc.pathname} params={Promise.resolve(params)} />
      </OperatorLayout>
    </LocationContext.Provider>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
