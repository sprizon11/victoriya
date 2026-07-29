import * as React from "react";
import { cn } from "../../lib/utils";

const Input = React.forwardRef(({ className, type, ...props }, ref) => (
  <input
    type={type}
    ref={ref}
    className={cn(
      "flex h-9 w-full rounded-lg border border-input bg-card px-2.5 py-1 text-[13px] shadow-xs",
      "transition-[border-color,box-shadow,background-color] duration-150 ease-out-soft",
      "placeholder:text-slate-400",
      "hover:border-slate-300",
      "focus-visible:border-brand/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/20 focus-visible:ring-offset-0",
      "disabled:cursor-not-allowed disabled:bg-slate-50 disabled:opacity-60",
      className
    )}
    {...props}
  />
));
Input.displayName = "Input";

export { Input };
