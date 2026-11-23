/**
 * Whether the page is in the background. A hidden browser tab still receives every agent and
 * workspace event, so its polls and refreshes wait until the tab shows again. Native apps and
 * tests have no page document and count as visible.
 */
interface PageDocument {
  visibilityState?: string;
  addEventListener(type: "visibilitychange", listener: () => void): void;
  removeEventListener(type: "visibilitychange", listener: () => void): void;
}

// Read through globalThis: client code stays free of direct browser globals (mobile audit).
function pageDocument(): PageDocument | undefined {
  return (globalThis as { document?: PageDocument }).document;
}

export function isHidden(): boolean {
  return pageDocument()?.visibilityState === "hidden";
}

/** Calls `callback` each time the page becomes visible; returns the cleanup. */
export function onVisible(callback: () => void): () => void {
  const page = pageDocument();
  if (!page) return () => undefined;
  const listener = () => {
    if (page.visibilityState === "visible") callback();
  };
  page.addEventListener("visibilitychange", listener);
  return () => page.removeEventListener("visibilitychange", listener);
}
