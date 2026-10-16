/**
 * Stand-in for "next/navigation" in the single-file demo build.
 *
 * The standalone HTML file is opened straight from disk (file://), so there is
 * no server to resolve paths like /operator/inbox. Routes live in the URL hash
 * instead: file:///…/vantalos-demo.html#/operator/inbox?taskId=…
 */
import { createContext, useContext, useMemo } from "react";

export interface HashLocation {
  pathname: string;
  search: string;
  params: Record<string, string>;
}

export const LocationContext = createContext<HashLocation>({ pathname: "/operator", search: "", params: {} });

export function readHash(): { pathname: string; search: string } {
  const raw = window.location.hash.replace(/^#/, "") || "/operator";
  const [pathname, search = ""] = raw.split("?");
  return { pathname: pathname || "/operator", search };
}

function go(href: string, replace: boolean) {
  const target = "#" + href;
  if (replace) {
    window.location.replace(target);
  } else {
    window.location.hash = href;
  }
  window.scrollTo(0, 0);
}

const router = {
  push: (href: string) => go(href, false),
  replace: (href: string) => go(href, true),
  back: () => window.history.back(),
  forward: () => window.history.forward(),
  refresh: () => {},
  prefetch: () => {},
};

export function useRouter() {
  return router;
}

export function usePathname() {
  return useContext(LocationContext).pathname;
}

export function useSearchParams() {
  const { search } = useContext(LocationContext);
  return useMemo(() => new URLSearchParams(search), [search]);
}

export function useParams<T extends Record<string, string> = Record<string, string>>() {
  return useContext(LocationContext).params as T;
}

export function redirect(href: string): never {
  go(href, true);
  throw new Error("redirect");
}

export function notFound(): never {
  throw new Error("Not found");
}
