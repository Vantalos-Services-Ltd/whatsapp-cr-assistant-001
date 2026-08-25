"use client";

import { useEffect, useState } from "react";
import { Menu, X } from "lucide-react";
import { useRouter, usePathname } from "next/navigation";
import { Sidebar, SidebarContent, SidebarHeader, SidebarNav, SidebarNavItem } from "@/components/ui/sidebar";
import { checkAuth, logout } from "@/lib/auth";
import { OperatorProviders } from "@/components/common/OperatorProviders";
import { useDataStatusStore } from "@/lib/dataStatusStore";
import { StatusPill } from "@/components/common/StatusPill";
import { NetworkStatusMonitor } from "@/components/common/NetworkStatusMonitor";
import { initDataStatusStore } from "@/lib/api";

function HeaderContent({ onMenuClick }: { onMenuClick: () => void }) {
  const router = useRouter();
  const { state, deriveStatus, setRefreshing, setUpToDate, setOutOfDate, setOffline } = useDataStatusStore();
  const effectiveStatus = deriveStatus();

  // Initialize API client with status store
  useEffect(() => {
    initDataStatusStore({
      setRefreshing,
      setUpToDate,
      setOutOfDate,
      setOffline,
    });
  }, [setRefreshing, setUpToDate, setOutOfDate, setOffline]);

  const handleLogout = async () => {
    await logout();
    router.push("/operator/login");
  };

  return (
    <header className="flex h-16 items-center border-b bg-background px-6 shrink-0">
      <div className="flex items-center justify-between w-full">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onMenuClick}
            aria-label="Open navigation menu"
            className="md:hidden rounded p-2 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Menu className="h-5 w-5" />
          </button>
          <span className="text-sm font-medium text-muted-foreground">Operator console</span>
        </div>
        <div className="flex items-center gap-4">
          <StatusPill
            status={effectiveStatus}
            lastSuccessAt={state.lastSuccessAt}
            lastErrorMessage={state.lastErrorMessage}
          />
          <span
            className="hidden sm:inline text-xs text-muted-foreground uppercase tracking-wide"
            title="Running against the local database on this machine — not live candidate data"
          >
            Local data
          </span>
          <button
            onClick={handleLogout}
            className="text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            Logout
          </button>
        </div>
      </div>
    </header>
  );
}

export default function OperatorLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [isAuthenticated, setIsAuthenticated] = useState<boolean | null>(null);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  // Close the mobile drawer whenever the route changes
  useEffect(() => { setMobileNavOpen(false); }, [pathname]);

  useEffect(() => {
    async function verifyAuth() {
      const authenticated = await checkAuth();
      setIsAuthenticated(authenticated);
      
      if (!authenticated && pathname !== "/operator/login") {
        router.push("/operator/login");
      }
    }

    verifyAuth();
  }, [pathname, router]);

  // Show nothing while checking auth
  if (isAuthenticated === null) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="text-sm text-muted-foreground">Loading...</div>
      </div>
    );
  }

  // Don't show layout on login page
  if (pathname === "/operator/login") {
    return <>{children}</>;
  }

  return (
    <OperatorProviders>
      <NetworkStatusMonitor />
      <div className="flex h-screen overflow-hidden">
        {/* Backdrop shown only while the drawer is open on small screens */}
        {mobileNavOpen && (
          <div
            className="fixed inset-0 z-30 bg-black/40 md:hidden"
            onClick={() => setMobileNavOpen(false)}
            aria-hidden="true"
          />
        )}
        {/* Sidebar: a slide-over drawer under 768px, static from md upwards.
            It previously occupied a third of a phone screen with no way to
            dismiss it, leaving the task list and approval panel unreachable. */}
        <div
          className={`fixed inset-y-0 left-0 z-40 transition-transform duration-200 md:static md:z-auto md:translate-x-0 ${
            mobileNavOpen ? "translate-x-0" : "-translate-x-full"
          }`}
        >
          <Sidebar>
            <SidebarHeader>
              <div className="flex items-center justify-between w-full">
                <h2 className="text-lg font-semibold text-foreground">Vantalos</h2>
                <button
                  type="button"
                  onClick={() => setMobileNavOpen(false)}
                  aria-label="Close navigation menu"
                  className="md:hidden rounded p-2 hover:bg-muted"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
            </SidebarHeader>
            <SidebarContent>
              {/* The drawer closes via the pathname effect above, so nav items
                  need no extra handler. */}
              <SidebarNav>
              <SidebarNavItem href="/operator">Dashboard</SidebarNavItem>
              <SidebarNavItem href="/operator/inbox">Inbox</SidebarNavItem>
              <SidebarNavItem href="/operator/tasks">Tasks</SidebarNavItem>
              <SidebarNavItem href="/operator/messages">Messages</SidebarNavItem>
              <SidebarNavItem href="/operator/search">Candidates</SidebarNavItem>
              <SidebarNavItem href="/operator/jobs">Jobs</SidebarNavItem>
              <SidebarNavItem href="/operator/contacts">Contacts</SidebarNavItem>
              <SidebarNavItem href="/operator/review">Review</SidebarNavItem>
              <SidebarNavItem href="/operator/settings">Settings</SidebarNavItem>
            </SidebarNav>
          </SidebarContent>
          </Sidebar>
        </div>
        <div className="flex flex-1 flex-col h-full min-w-0">
          <HeaderContent onMenuClick={() => setMobileNavOpen(true)} />
          <main className="flex-1 overflow-y-auto bg-background p-4 md:p-6">
            {children}
          </main>
        </div>
      </div>
    </OperatorProviders>
  );
}
