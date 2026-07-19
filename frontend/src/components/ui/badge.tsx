import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap",
  {
    variants: {
      variant: {
        default: "border-line-strong bg-paper text-ink-muted",
        live: "border-transparent bg-status-live-bg text-status-live",
        done: "border-transparent bg-status-done-bg text-status-done",
        flag: "border-transparent bg-status-flag-bg text-status-flag",
        pending: "border-transparent bg-status-pending-bg text-status-pending",
        action: "border-transparent bg-action/10 text-action",
      },
    },
    defaultVariants: { variant: "default" },
  }
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant, className }))} {...props} />;
}

export { Badge, badgeVariants };
