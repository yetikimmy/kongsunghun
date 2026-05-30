/*
 * Build a link to an absolute site path that resolves correctly no matter
 * what sub-path the static output is mounted under (e.g. preview deploys that
 * serve the site from /some/prefix/). Returns a path relative to the current
 * page, so the browser never needs to know the deploy root.
 */
export function relativeHref(target: string, currentPathname: string): string {
  const toSegments = (p: string) => p.replace(/^\/+|\/+$/g, "").split("/").filter(Boolean);

  // Directory of the current page (pages build to <path>/index.html, so the
  // current pathname is treated as a directory).
  const fromDir = toSegments(currentPathname);
  const toParts = toSegments(target);

  // Drop the common leading segments.
  let i = 0;
  while (i < fromDir.length && i < toParts.length && fromDir[i] === toParts[i]) {
    i++;
  }

  const up = fromDir.length - i;
  const down = toParts.slice(i);
  const rel = [...Array(up).fill(".."), ...down].join("/");

  // Preserve trailing slash for directory-style targets; ensure non-empty.
  const trailing = target.endsWith("/") ? "/" : "";
  if (rel === "") return trailing ? "./" : "./";
  return rel + trailing;
}
