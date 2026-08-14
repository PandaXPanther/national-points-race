export const SITE_NAME = "National Points Race";
export const SITE_ORIGIN = "https://extempcentral.org";
export const DEFAULT_SOCIAL_IMAGE = "/social-card.png";

export function absoluteUrl(pathname: string): string {
  return new URL(pathname, `${SITE_ORIGIN}/`).toString();
}

export function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}
