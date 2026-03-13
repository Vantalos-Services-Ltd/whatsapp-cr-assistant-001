"use client";

import { ToastProvider } from "@/components/toast";
import { DataStatusProvider } from "@/lib/dataStatusStore";
import { HeartbeatMonitor } from "@/components/common/HeartbeatMonitor";
import React from "react";

export function OperatorProviders({ children }: { children: React.ReactNode }) {
  return (
    <ToastProvider>
      <DataStatusProvider>
        <HeartbeatMonitor />
        {children}
      </DataStatusProvider>
    </ToastProvider>
  );
}

