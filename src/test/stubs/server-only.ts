/**
 * `server-only` throws on import outside a React Server Component graph, which
 * would break every Vitest file that touches server modules. Vitest aliases the
 * package to this no-op; the real guard still applies to `next build`.
 */
export {};
