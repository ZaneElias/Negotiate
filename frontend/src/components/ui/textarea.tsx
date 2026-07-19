import * as React from "react";
import { cn } from "@/lib/utils";

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      className={cn(
        "flex min-h-16 w-full rounded-md border border-line-strong bg-paper-raised px-3 py-2 text-sm text-ink shadow-sm cp-transition",
        "placeholder:text-ink-muted/70",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action/40 focus-visible:border-action",
        "disabled:cursor-not-allowed disabled:opacity-50",
        className
      )}
      {...props}
    />
  );
}

export { Textarea };
