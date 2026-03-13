"use client";

import React from "react";

interface ToastViewportProps {
  children: React.ReactNode;
}

export function ToastViewport({ children }: ToastViewportProps) {
  return (
    <div
      className="fixed top-5 right-5 z-[100] flex flex-col gap-3 pointer-events-none max-w-[450px]"
      aria-live="polite"
      aria-label="Notifications"
    >
      {children}
    </div>
  );
}

