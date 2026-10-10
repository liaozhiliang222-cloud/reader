/** Destinations are displayed/copied or resolved locally, never navigated. */
export function markdownLink(href: string): string | undefined {
  if (href.startsWith('#') && !/[\p{Cc}\s]/u.test(href)) return href;
  if (!/^https?:\/\//i.test(href) || /[\p{Cc}\s]/u.test(href)) return;
  try {
    return new URL(href).href;
  } catch {
    return;
  }
}
