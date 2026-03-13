"use client";

import { useState, useRef, useEffect } from "react";
import { Info } from "lucide-react";
import { useToast } from "@/components/toast";
import { cn } from "@/lib/utils";

interface PersonLabelProps {
  primary: string;
  phone?: string | null;
  subtitle?: string | null;
  showTradeInline?: boolean; // Default true, but not used in current implementation
  className?: string;
}

export function PersonLabel({
  primary,
  phone,
  subtitle,
  showTradeInline = true,
  className,
}: PersonLabelProps) {
  const [showTooltip, setShowTooltip] = useState(false);
  const [copied, setCopied] = useState(false);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const { pushToast } = useToast();

  // Enforce rule: Never show phone as primary text UNLESS it's a candidate context
  // If primary is a phone number AND no phone prop is provided, replace with placeholder
  // If phone prop is provided, allow phone as primary (candidate without name case)
  const isPhoneNumber = (text: string): boolean => {
    const cleanText = text.trim();
    // Check if it looks like a phone number (starts with +, or is mostly digits/spaces/parentheses/dashes)
    return /^\+?\d[\d\s\-\(\)]+$/.test(cleanText) && cleanText.length >= 7;
  };

  // Only replace phone with "Contact" if no phone prop is provided (non-candidate context)
  const displayPrimary = (isPhoneNumber(primary) && !phone) ? "Contact" : primary;

  // Handle click outside to close tooltip
  useEffect(() => {
    if (!showTooltip) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setShowTooltip(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [showTooltip]);

  const handleCopyPhone = async (e?: React.MouseEvent | React.KeyboardEvent) => {
    if (e) {
      e.stopPropagation();
    }
    if (!phone) return;

    try {
      await navigator.clipboard.writeText(phone);
      setCopied(true);
      
      // Show tiny "Copied" toast
      pushToast({
        variant: "success",
        title: "Copied",
        confirmation: "Phone number copied to clipboard",
      });

      // Reset copied state after a short delay
      setTimeout(() => {
        setCopied(false);
      }, 2000);
    } catch (err) {
      console.error("Failed to copy phone:", err);
    }
  };

  return (
    <div ref={containerRef} className={cn("relative inline-flex items-center gap-1.5", className)}>
      <span className="text-foreground">{displayPrimary}</span>
      
      {phone && (
        <div className="relative">
          <span
            role="button"
            tabIndex={0}
            onMouseEnter={() => setShowTooltip(true)}
            onMouseLeave={() => setShowTooltip(false)}
            onClick={(e) => {
              e.stopPropagation();
              setShowTooltip(!showTooltip);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                e.stopPropagation();
                setShowTooltip(!showTooltip);
              }
            }}
            className="text-muted-foreground hover:text-foreground transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1 rounded cursor-pointer"
            aria-label="Show phone number"
          >
            <Info className="w-3.5 h-3.5" />
          </span>

          {/* Tooltip */}
          {showTooltip && (
            <div
              ref={tooltipRef}
              className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 z-50"
              onMouseEnter={() => setShowTooltip(true)}
              onMouseLeave={() => setShowTooltip(false)}
            >
              <div className="bg-background border border-border rounded-md shadow-lg px-3 py-2 text-sm text-foreground whitespace-nowrap">
                <div className="flex items-center gap-2">
                  <span>{phone}</span>
                  <span
                    role="button"
                    tabIndex={0}
                    onClick={handleCopyPhone}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        handleCopyPhone(e);
                      }
                    }}
                    className="text-muted-foreground hover:text-foreground transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1 rounded px-1 cursor-pointer"
                    aria-label="Copy phone number"
                  >
                    {copied ? (
                      <span className="text-xs text-green-600">✓</span>
                    ) : (
                      <span className="text-xs">📋</span>
                    )}
                  </span>
                </div>
                {/* Arrow */}
                <div className="absolute top-full left-1/2 -translate-x-1/2 -mt-px">
                  <div className="w-2 h-2 bg-background border-r border-b border-border rotate-45"></div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {subtitle && (
        <span className="text-xs text-muted-foreground">({subtitle})</span>
      )}
    </div>
  );
}

