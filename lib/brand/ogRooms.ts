/**
 * Which three rooms the share card shows.
 *
 * Named rather than "the first three by sort order". This is the shop window —
 * for most people it is the entire impression of the place before they decide
 * whether to click — and sort order is the lobby's job, with nothing to say
 * about that. Leaving it implicit meant the card picked its own advertisement.
 *
 * Poker is deliberately absent. It stays a real room; §4.2's fixed set is fine
 * as it is. But "bad beats and good folds" as one of three things a stranger
 * learns about this place reads as a gambling site, which is not what it is.
 * Commons says everyone, music says interests, kitchen says ordinary life —
 * the spread §5 is after.
 *
 * Every slug here must be a room that exists. A card advertising a door that
 * opens onto nothing is worse than a card showing a room you would rather it
 * did not; `lib/brand/og.test.ts` refuses to let that happen.
 *
 * Three, because nine lines is what the card holds above the footer and each
 * room costs two.
 */
export const ON_THE_CARD = ['commons', 'music', 'kitchen'] as const
