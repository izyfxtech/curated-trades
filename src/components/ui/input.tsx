import * as React from "react";

import { cn } from "@/lib/utils";

const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<"input">>(
  ({ className, type, onWheel, ...props }, ref) => {
    return (
      <input
        type={type}
        // A number input focused under the cursor silently changes value on
        // any scroll wheel movement over the page — the browser treats wheel
        // input as up/down arrows for a focused <input type="number">. Since
        // this Input is used for every numeric field in the app (entry/exit
        // price, size, stop, targets, risk %, and more), an accidental
        // scroll while reading the page could silently corrupt a trade's
        // numbers without any visual cue. Blurring on wheel is the standard
        // fix: it only takes effect while the field is focused, so normal
        // page scrolling is completely unaffected, and a person who actually
        // wants to change the value can still use the spinner arrows or type.
        onWheel={(event) => {
          if (type === "number" && document.activeElement === event.currentTarget) {
            event.currentTarget.blur();
          }
          onWheel?.(event);
        }}
        className={cn(
          "flex h-9 w-full rounded-lg border border-input bg-card px-3 py-1 text-base shadow-xs transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/25 disabled:cursor-not-allowed disabled:opacity-50 md:text-[13px]",
          className,
        )}
        ref={ref}
        {...props}
      />
    );
  },
);
Input.displayName = "Input";

export { Input };
