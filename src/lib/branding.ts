import { APP_NAME, CATALOG_TAGLINE } from "./brand.ts";

export const BRANDING_BUCKET = "basecamp-branding";
export const MAX_LOGO_BYTES = 2 * 1024 * 1024;
export const ACCEPTED_LOGO_TYPES = ["image/png", "image/jpeg", "image/webp"] as const;

export type BrandingRow = {
  display_name: string;
  logo_path: string | null;
};

export type Branding = {
  displayName: string;
  logoPath: string | null;
  logoUrl: string | null;
};

export const FALLBACK_BRANDING: Branding = {
  displayName: APP_NAME,
  logoPath: null,
  logoUrl: null,
};

export const BRANDING_TAGLINE = CATALOG_TAGLINE;

const LOGO_PATH = /^logos\/[0-9a-f-]{36}\.(png|jpg|webp)$/;

export function displayNameProblem(value: string): string | null {
  const name = value.trim();
  if (!name) return "Give this Basecamp a display name.";
  if (name.length > 100) return "The display name must be 100 characters or fewer.";
  return null;
}

export function logoFileProblem(file: { size: number; type: string }): string | null {
  if (!ACCEPTED_LOGO_TYPES.includes(file.type as (typeof ACCEPTED_LOGO_TYPES)[number])) {
    return "Choose a PNG, JPEG, or WebP image.";
  }
  if (file.size <= 0) return "That logo file is empty.";
  if (file.size > MAX_LOGO_BYTES) return "The logo must be 2 MB or smaller.";
  return null;
}

export function logoExtension(type: string): "png" | "jpg" | "webp" | null {
  if (type === "image/png") return "png";
  if (type === "image/jpeg") return "jpg";
  if (type === "image/webp") return "webp";
  return null;
}

export function logoObjectPath(type: string, id: string): string | null {
  const extension = logoExtension(type);
  return extension ? `logos/${id}.${extension}` : null;
}

export function publicLogoUrl(supabaseUrl: string, path: string | null): string | null {
  if (!path || !LOGO_PATH.test(path)) return null;
  const encodedPath = path.split("/").map(encodeURIComponent).join("/");
  return `${supabaseUrl.replace(/\/$/, "")}/storage/v1/object/public/${BRANDING_BUCKET}/${encodedPath}`;
}

export function resolveBranding(row: BrandingRow | null, supabaseUrl: string): Branding {
  if (!row || displayNameProblem(row.display_name)) return FALLBACK_BRANDING;
  return {
    displayName: row.display_name.trim(),
    logoPath: row.logo_path,
    logoUrl: publicLogoUrl(supabaseUrl, row.logo_path),
  };
}
