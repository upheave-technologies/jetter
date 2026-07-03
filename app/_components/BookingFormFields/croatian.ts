// ---------------------------------------------------------------------------
// croatian.ts — Croatian noun declension helpers for the Booth Board UI.
//
// These are purely UI-formatting concerns and belong beside the component that
// renders them. Domain logic (booking rules, availability) stays in modules/.
// ---------------------------------------------------------------------------

/**
 * Returns the grammatically correct Croatian form for a skuter count.
 *
 * Croatian declension:
 *   1        → "1 skuter"   (nominative singular)
 *   2–4      → "{n} skutera" (plural-genitive)
 *   5+       → "{n} skutera" (plural-genitive; same form as 2–4)
 *
 * The only distinction that matters within the 1–6 fleet range:
 *   1 → singular nominative ("skuter")
 *   anything else → plural genitive ("skutera")
 */
export function skuterForm(q: number): string {
  return q === 1 ? '1 skuter' : `${q} skutera`;
}
