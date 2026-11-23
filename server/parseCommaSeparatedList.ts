/**
 * Splits a comma-separated environment value into its entries, trimming each
 * one and dropping the empty ones. `.env` files commonly carry `A, B,`, and
 * the spaces and the trailing comma are never part of an entry.
 */
export function parseCommaSeparatedList(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}
