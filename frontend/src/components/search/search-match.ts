// Managed file. Edit it in sirloinbh/project-standards templates/ui/frontend/src/components/search/
// Matching for the top bar search (#58): every word of the query must appear in the title or a keyword,
// ignoring case. An empty query matches nothing, so the dialog opens empty instead of listing every page.

export type SearchResultKind = 'menu' | 'page' | 'content';

export type SearchResult = {
  title: string;
  href: string;
  kind: SearchResultKind;
  snippet?: string;
};

/** A page of the app that is not in the menu (title, path, extra words to find it by). */
export type SearchPage = { title: string; path: string; keywords?: string[] };

export function matchesQuery(query: string, ...texts: (string | undefined)[]): boolean {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return false;
  const haystack = texts.join(' ').toLowerCase();
  return words.every((word) => haystack.includes(word));
}
