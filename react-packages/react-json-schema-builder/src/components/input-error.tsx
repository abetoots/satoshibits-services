import type React from "react";
import { cn, ROOT_CLASS } from "@/lib/utils";

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
    <div className={cn(ROOT_CLASS, "rjsb:space-y-2", className)}>
      {showError && errorCode && (
        <div
          className="rjsb:text-sm rjsb:font-medium rjsb:text-destructive"
          aria-live="polite"
        >
          {errorCode}
        </div>
      )}

      {children}

      {showError && errorDescription && (
        <div className="rjsb:text-sm rjsb:text-destructive" aria-live="polite">
          {errorDescription}
        </div>
      )}
    </div>
  );
}
