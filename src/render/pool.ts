/**
 * Recycles a pool slot by shifting whole windows into `[lo, lo + window)`.
 *
 * The bound is the window, not `s + ahead`: a pool carries one spare position
 * beyond the visible span, so testing against `ahead` leaves that slot with
 * nowhere legal to sit and it oscillates back out of view every frame.
 */
export function wrapSlot(slot: number, lo: number, window: number): number {
  let wrapped = slot;
  while (wrapped < lo) wrapped += window;
  while (wrapped >= lo + window) wrapped -= window;
  return wrapped;
}
