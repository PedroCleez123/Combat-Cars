export const ONLINE_ACCESS_TOKEN_STORAGE_KEY = "arsenal-online-access-token";

/** Extract a fragment-delivered access token without ever placing it in a URL. */
export function readOnlineAccessTokenFragment(hash) {
  if (typeof hash !== "string" || !hash.startsWith("#")) return null;
  const values = new URLSearchParams(hash.slice(1)).getAll("access_token");
  return values.length === 1 && values[0] ? values[0] : null;
}

/**
 * Store a fragment token for this tab only. The caller owns history cleanup so
 * this pure helper remains testable without DOM globals.
 */
export function consumeOnlineAccessTokenFragment({ hash = "", storage } = {}) {
  const fragmentToken = readOnlineAccessTokenFragment(hash);
  if (fragmentToken) {
    try { storage?.setItem?.(ONLINE_ACCESS_TOKEN_STORAGE_KEY, fragmentToken); } catch { /* private storage can be unavailable */ }
  }
  let storedToken = null;
  try { storedToken = storage?.getItem?.(ONLINE_ACCESS_TOKEN_STORAGE_KEY) || null; } catch { /* use fragment token below */ }
  return { token: fragmentToken || storedToken, hadAccessTokenFragment: Boolean(fragmentToken) };
}
