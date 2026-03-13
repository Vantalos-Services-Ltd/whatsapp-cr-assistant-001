"use client";

import { useEffect, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { Sidebar, SidebarContent, SidebarHeader, SidebarNav, SidebarNavItem } from "@/components/ui/sidebar";
import { checkAuth, logout } from "@/lib/auth";
import { OperatorProviders } from "@/components/common/OperatorProviders";
import { useDataStatusStore } from "@/lib/dataStatusStore";
import { StatusPill } from "@/components/common/StatusPill";
import { NetworkStatusMonitor } from "@/components/common/NetworkStatusMonitor";
import { initDataStatusStore } from "@/lib/api";

function HeaderContent() {
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
        <h1 className="text-xl font-semibold text-foreground">Vantalos</h1>
        <div className="flex items-center gap-4">
          <StatusPill
            status={effectiveStatus}
            lastSuccessAt={state.lastSuccessAt}
            lastErrorMessage={state.lastErrorMessage}
          />
          <span className="text-xs text-muted-foreground uppercase tracking-wide">Local</span>
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
        <Sidebar>
          <SidebarHeader>
            <h2 className="text-lg font-semibold text-foreground">Vantalos</h2>
          </SidebarHeader>
          <SidebarContent>
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
        <div className="flex flex-1 flex-col h-full">
          <HeaderContent />
          <main className="flex-1 overflow-y-auto bg-background p-6">
            {children}
          </main>
        </div>
      </div>
    </OperatorProviders>
  );
}
