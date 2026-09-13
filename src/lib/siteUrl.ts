/**
 * Resolve the public app origin used in credentials handed to people.
 *
 * A request can arrive through a Vercel deployment hostname even when the app
 * has a client-owned custom domain. Credential links must use the configured
 * public address rather than whichever alias the administrator happened to
 * open. Local development and an unconfigured preview still fall back to the
 * request origin so a fresh checkout remains usable before deployment setup.
 */
export function basecampLinkOrigin(
  requestUrl: string,
  configuredSiteUrl = process.env.BASECAMP_SITE_URL,
): string {
  if (!configuredSiteUrl?.trim()) return new URL(requestUrl).origin;

  const value = configuredSiteUrl.trim();
  const site = new URL(value);
  if (site.protocol !== "https:" && site.protocol !== "http:") {
    throw new Error("BASECAMP_SITE_URL must use http or https.");
  }
  if (site.username || site.password || site.search || site.hash) {
    throw new Error("BASECAMP_SITE_URL must be a plain public origin.");
  }
  if (site.pathname !== "/") {
    throw new Error("BASECAMP_SITE_URL must not include a path.");
  }
  if (process.env.NODE_ENV === "production" && site.protocol !== "https:") {
    throw new Error("BASECAMP_SITE_URL must use https in production.");
  }

  return site.origin;
}
