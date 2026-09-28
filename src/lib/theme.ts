// Light/dark theme for the whole app. The choice lives in localStorage under
// "ct-theme"; when nothing is stored we follow the OS setting. The class is
// applied to <html> by THEME_INIT_SCRIPT (inlined in __root.tsx's <head> so it
// runs before first paint and there is no light-to-dark flash), and kept in
// sync from here afterwards. Colours themselves are tokens in styles.css —
// nothing in this file knows what "dark" looks like.
import { useCallback, useEffect, useState } from "react";

export type Theme = "light" | "dark";

const STORAGE_KEY = "ct-theme";

/** Inlined verbatim into <head>; must stay dependency-free and never throw. */
export const THEME_INIT_SCRIPT = `(function(){try{var t=localStorage.getItem("${STORAGE_KEY}");if(!t){t=window.matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light"}document.documentElement.classList.toggle("dark",t==="dark")}catch(e){}})();`;

export function useTheme(): { theme: Theme; toggleTheme: () => void } {
  // "light" on the server / first render; corrected from the DOM in the
  // effect below so hydration markup matches.
  const [theme, setTheme] = useState<Theme>("light");

  useEffect(() => {
    setTheme(document.documentElement.classList.contains("dark") ? "dark" : "light");
  }, []);

  const toggleTheme = useCallback(() => {
    const next: Theme = document.documentElement.classList.contains("dark") ? "light" : "dark";
    document.documentElement.classList.toggle("dark", next === "dark");
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Private mode / storage disabled: the toggle still works for this session.
    }
    setTheme(next);
  }, []);

  return { theme, toggleTheme };
}
