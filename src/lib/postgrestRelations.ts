/**
 * Normalize a PostgREST to-one embed before it crosses the Server Component
 * boundary. Depending on relationship metadata and row presence, Supabase can
 * return a single object, a one-item array, or null.
 */
export function relationOne<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

/**
 * Normalize a PostgREST to-many embed before client code maps or indexes it.
 * An absent relationship is represented as an empty collection, never null.
 */
export function relationMany<T>(value: T[] | null | undefined): T[] {
  return Array.isArray(value) ? value : [];
}
