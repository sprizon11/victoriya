import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva } from "class-variance-authority";
import { cn } from "../../lib/utils";

const buttonVariants = cva(
  // `press` gives every button the same tactile 140ms depress; cursor-pointer is
  // explicit so clickability is never ambiguous.
  "press inline-flex cursor-pointer items-center justify-center gap-1.5 whitespace-nowrap rounded-lg text-[13px] font-medium " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:ring-offset-2 " +
  "disabled:pointer-events-none disabled:opacity-45 [&_svg]:pointer-events-none [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default:
          "bg-brand text-white shadow-card hover:bg-brand-600 hover:shadow-float active:bg-brand-700",
        accent:
          "bg-leaf text-white shadow-card hover:brightness-95 hover:shadow-float",
        destructive:
          "bg-destructive text-destructive-foreground shadow-card hover:brightness-95 hover:shadow-float",
        outline:
          "border border-input bg-card text-slate-700 shadow-xs hover:border-brand/40 hover:bg-brand-50 hover:text-brand",
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-slate-200",
        ghost:
          "text-slate-600 hover:bg-slate-100 hover:text-slate-900",
        subtle:
          "bg-brand/10 text-brand hover:bg-brand/20",
        link:
          "text-brand underline-offset-4 hover:underline",
      },
      size: {
        default: "h-9 px-3.5",
        sm: "h-8 rounded-md px-2.5 text-xs",
        xs: "h-7 rounded-md px-2 text-[11px]",
        lg: "h-10 rounded-lg px-6 text-sm",
        icon: "h-9 w-9",
        iconSm: "h-7 w-7 rounded-md",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  }
);

const Button = React.forwardRef(({ className, variant, size, asChild = false, loading, children, ...props }, ref) => {
  const Comp = asChild ? Slot : "button";
  if (asChild) {
    return <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props}>{children}</Comp>;
  }
  return (
    <Comp
      className={cn(buttonVariants({ variant, size, className }))}
      ref={ref}
      {...props}
      disabled={props.disabled || loading}
    >
      {loading && <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" />}
      {children}
    </Comp>
  );
});
Button.displayName = "Button";

export { Button, buttonVariants };
