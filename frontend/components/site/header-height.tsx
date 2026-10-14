"use client";

import { useEffect } from "react";

/**
 * Keeps `--header-h` on <html> equal to the sticky header's height (it differs with the width and the fonts), so
 * the client's side panel sits right under it and fills the rest of the screen.
 */
export function HeaderHeight() {
  useEffect(() => {
    const header = document.querySelector<HTMLElement>("header[data-site-header]");
    if (!header) return;
    const set = () => document.documentElement.style.setProperty("--header-h", `${header.offsetHeight}px`);
    set();
    const observer = new ResizeObserver(set);
    observer.observe(header);
    return () => observer.disconnect();
  }, []);
  return null;
}
