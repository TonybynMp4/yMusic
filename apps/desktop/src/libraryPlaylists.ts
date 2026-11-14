import type { BrowseCard } from "@ymusic/core";

export const LIKED_MUSIC = "LM";

/**
 * Overlay entries kept with the account they were made under, so switching
 * accounts drops them.
 */
export interface Scoped<T> {
  account: string | null;
  items: readonly T[];
}

const NONE: readonly never[] = [];

export function unscoped<T>(): Scoped<T> {
  return { account: null, items: NONE };
}

/** The entries for `account`, or none when they belong to another. */
export function itemsFor<T>(scope: Scoped<T>, account: string | null): readonly T[] {
  return scope.account === account ? scope.items : NONE;
}

/** Puts a new playlist first among the pending ones, once. */
export function addPending(
  pending: Scoped<BrowseCard>,
  account: string | null,
  card: BrowseCard,
): Scoped<BrowseCard> {
  const others = itemsFor(pending, account).filter((c) => c.id !== card.id);
  return { account, items: [card, ...others] };
}

/** Records a deleted playlist, so the list hides it. */
export function addGone(gone: Scoped<string>, account: string | null, id: string): Scoped<string> {
  return { account, items: [id, ...itemsFor(gone, account)] };
}

/** Drops a playlist from the pending ones, whichever account they belong to. */
export function dropPending(pending: Scoped<BrowseCard>, id: string): Scoped<BrowseCard> {
  return { account: pending.account, items: pending.items.filter((card) => card.id !== id) };
}

/**
 * Takes out the pending playlists the fetched list has. Once the list has one
 * it stops being pending, so removing it elsewhere later does not bring the
 * placeholder back. Returns `pending` itself when nothing changes.
 */
export function prunePending(
  pending: Scoped<BrowseCard>,
  account: string | null,
  listed: readonly BrowseCard[],
): Scoped<BrowseCard> {
  if (pending.account !== account) return pending;
  const missing = pending.items.filter((card) => !listed.some((p) => p.id === card.id));
  return missing.length < pending.items.length ? { account, items: missing } : pending;
}

/**
 * The list to show: the fetched one without the `gone` playlists, and the
 * `pending` ones where YouTube Music puts new playlists, first after Liked
 * Music. `pending` is already pruned, so the fetched list has none of them.
 */
export function mergePlaylists(
  listed: readonly BrowseCard[],
  pending: readonly BrowseCard[],
  gone: readonly string[],
): BrowseCard[] {
  const kept = listed.filter((p) => !gone.includes(p.id));
  if (pending.length === 0) return kept;
  const liked = kept.filter((p) => p.id === LIKED_MUSIC);
  const rest = kept.filter((p) => p.id !== LIKED_MUSIC);
  return [...liked, ...pending, ...rest];
}
