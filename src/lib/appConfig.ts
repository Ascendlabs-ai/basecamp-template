import { APP_NAME } from "./brand.ts";

export type AppAuthMode = "basecamp_sso" | "external_sign_in" | "link_only";
export type AppAccessMode = "everyone" | "selected";
export type SsoReadiness = "not_configured" | "ready" | "failing";

export type OAuthClientConfig = {
  id?: string;
  entry_id: string;
  client_id: string;
  redirect_uris: string[];
  enabled: boolean;
};

export type AppSettings = {
  entry_id: string;
  access_mode: AppAccessMode;
  auth_mode: AppAuthMode;
  is_active: boolean;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isAllowedRedirectUri(value: string): boolean {
  try {
    const url = new URL(value);
    if (url.username || url.password || url.hash) return false;
    if (url.protocol === "https:") return true;
    return url.protocol === "http:" && (url.hostname === "localhost" || url.hostname === "127.0.0.1");
  } catch {
    return false;
  }
}

export function parseRedirectUris(value: string): string[] {
  return [...new Set(value.split(/[\n,]/).map((item) => item.trim()).filter(Boolean))];
}

export function validateOAuthClient(config: OAuthClientConfig | null): string | null {
  if (!config) return "Register the OAuth client before marking this app ready.";
  if (!UUID.test(config.client_id)) return "The OAuth client ID must be a UUID issued by Supabase.";
  if (!config.enabled) return "The OAuth client mapping is disabled.";
  if (config.redirect_uris.length === 0) return "Add at least one exact redirect URI.";
  const invalid = config.redirect_uris.find((uri) => !isAllowedRedirectUri(uri));
  return invalid ? `Invalid redirect URI: ${invalid}` : null;
}

export function ssoReadiness(
  authMode: AppAuthMode,
  config: OAuthClientConfig | null,
): SsoReadiness {
  if (authMode !== "basecamp_sso") return "not_configured";
  if (!config) return "not_configured";
  return validateOAuthClient(config) ? "failing" : "ready";
}

export function authModeLabel(mode: AppAuthMode): string {
  if (mode === "basecamp_sso") return `${APP_NAME} SSO`;
  if (mode === "external_sign_in") return "Uses its own sign-in";
  return "Link only";
}
