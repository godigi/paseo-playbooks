/**
 * Whether the page is in the background. A hidden browser tab still receives every agent and
 * workspace event, so its polls and refreshes wait until the tab shows again. Native apps and
 * tests have no `document` and count as visible.
 */
export function isHidden(): boolean {
  return typeof document !== "undefined" && document.visibilityState === "hidden";
}

/** Calls `callback` each time the page becomes visible; returns the cleanup. */
export function onVisible(callback: () => void): () => void {
  if (typeof document === "undefined") return () => undefined;
  const listener = () => {
    if (document.visibilityState === "visible") callback();
  };
  document.addEventListener("visibilitychange", listener);
  return () => document.removeEventListener("visibilitychange", listener);
}
