import type React from "react";
import { cn } from "@/lib/utils";

interface InputErrorWrapperProps {
  children: React.ReactNode;
  errorCode?: string;
  errorDescription?: string;
  showError?: boolean;
  className?: string;
}

export function InputErrorWrapper({
  children,
  errorCode,
  errorDescription,
  showError = false,
  className,
}: InputErrorWrapperProps) {
  return (
    <div className={cn("space-y-2", className)}>
      {showError && errorCode && (
        <div
          className="text-sm font-medium text-destructive"
          aria-live="polite"
        >
          {errorCode}
        </div>
      )}

      {children}

      {showError && errorDescription && (
        <div className="text-sm text-destructive" aria-live="polite">
          {errorDescription}
        </div>
      )}
    </div>
  );
}
