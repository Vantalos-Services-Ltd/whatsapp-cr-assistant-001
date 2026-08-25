"use client";

import { useEffect } from "react";

/**
 * Keyboard shortcuts for the approve/reject queue.
 *
 * An operator working a full inbox previously had to mouse to every control.
 * These bindings let the common path — read, approve, next — happen without
 * leaving the keyboard.
 *
 *   J / ArrowDown   next task
 *   K / ArrowUp     previous task
 *   A               approve the selected task
 *   R               reject the selected task
 *   Escape          close the detail panel
 *
 * Deliberately inert while the user is typing in a field, holding a modifier,
 * or when no task is selected, so it can never fire mid-edit of a message.
 */
export interface ApprovalShortcutHandlers {
  onNext?: () => void;
  onPrevious?: () => void;
  onApprove?: () => void;
  onReject?: () => void;
  onClose?: () => void;
  enabled?: boolean;
}

function isTypingTarget(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  const tag = el.tagName.toLowerCase();
  return (
    tag === "input" ||
    tag === "textarea" ||
    tag === "select" ||
    el.isContentEditable
  );
}

export function useApprovalShortcuts({
  onNext,
  onPrevious,
  onApprove,
  onReject,
  onClose,
  enabled = true,
}: ApprovalShortcutHandlers) {
  useEffect(() => {
    if (!enabled) return;

    function handler(e: KeyboardEvent) {
      // Never hijack a keystroke meant for a text field or a browser shortcut.
      if (isTypingTarget(e.target)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      switch (e.key) {
        case "j":
        case "J":
        case "ArrowDown":
          if (onNext) { e.preventDefault(); onNext(); }
          break;
        case "k":
        case "K":
        case "ArrowUp":
          if (onPrevious) { e.preventDefault(); onPrevious(); }
          break;
        case "a":
        case "A":
          if (onApprove) { e.preventDefault(); onApprove(); }
          break;
        case "r":
        case "R":
          if (onReject) { e.preventDefault(); onReject(); }
          break;
        case "Escape":
          if (onClose) { e.preventDefault(); onClose(); }
          break;
      }
    }

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onNext, onPrevious, onApprove, onReject, onClose, enabled]);
}
