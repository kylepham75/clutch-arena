/**
 * Strips sensitive auth tokens (#access_token, #refresh_token) and OAuth codes (?code=)
 * from the browser address bar immediately after session authentication to prevent
 * credential leakage via URL sharing, browser history, or referrer headers.
 */
export function cleanAuthUrlFromBrowserHistory(): void {
  if (typeof window === "undefined" || !window.location || !window.history) {
    return;
  }

  try {
    const url = new URL(window.location.href);
    let changed = false;

    // Clean hash fragment if it contains sensitive tokens or error details
    if (
      url.hash &&
      (url.hash.includes("access_token") ||
        url.hash.includes("refresh_token") ||
        url.hash.includes("provider_token") ||
        url.hash.includes("error_description"))
    ) {
      url.hash = "";
      changed = true;
    }

    // Clean search parameters if they contain OAuth exchange code or provider errors
    if (
      url.searchParams.has("code") ||
      url.searchParams.has("error") ||
      url.searchParams.has("error_code") ||
      url.searchParams.has("error_description")
    ) {
      url.searchParams.delete("code");
      url.searchParams.delete("error");
      url.searchParams.delete("error_code");
      url.searchParams.delete("error_description");
      changed = true;
    }

    if (changed) {
      const cleanPath =
        url.pathname + (url.search ? url.search : "") + (url.hash ? url.hash : "");
      window.history.replaceState(null, "", cleanPath);
    }
  } catch {
    // Graceful fallback if URL or history API behaves unexpectedly
  }
}
