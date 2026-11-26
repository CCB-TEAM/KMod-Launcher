import { api, type Catalog } from "./api";

// the mod index is kept while the launcher runs; Discover and Mods share it
let cached: Catalog | null = null;
let pending: Promise<Catalog> | null = null;

export const cachedCatalog = () => cached;

/** The index, fetched again when `fresh` or not fetched yet. */
export function getCatalog(fresh = false): Promise<Catalog> {
  if (cached && !fresh) return Promise.resolve(cached);
  if (!pending) {
    pending = api
      .fetchCatalog()
      .then((c) => (cached = c))
      .finally(() => (pending = null));
  }
  return pending;
}
