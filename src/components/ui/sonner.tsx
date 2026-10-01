// App-wide toast host (sonner). Replaces the hand-rolled `notice` string +
// `window.setTimeout(() => setNotice(""), ms)` pattern that every page used to
// carry: call `toast.success(...)` / `toast.error(...)` from anywhere and this
// single <Toaster /> in the root route renders it. Follows the app theme via
// next-themes so toasts flip with the light/dark toggle.
import { useTheme } from "next-themes";
import { Toaster as Sonner, type ToasterProps } from "sonner";

export function Toaster(props: ToasterProps) {
  const { resolvedTheme } = useTheme();
  return (
    <Sonner
      theme={(resolvedTheme as ToasterProps["theme"]) ?? "system"}
      position="bottom-right"
      closeButton
      {...props}
    />
  );
}
