import { PROMOTION_STATUS } from "@/constants";

/**
 * Promotion's effect on discovery ordering (§41 Phase 2).
 *
 * Kept pure and away from the service so the two things that are easy to get
 * wrong — *when* a promotion is allowed to reorder anything, and *how* a
 * reordered result set still paginates — can be reasoned about and tested
 * without a database.
 *
 * The pipeline the search service runs is:
 *
 *     candidate tutors
 *       -> eligibility (`isSearchable`, the same gate as always)
 *       -> the visitor's filters (unchanged)
 *       -> the existing ranking (unchanged)
 *       -> promotion adjustment      <- only this file
 *       -> final results
 *
 * Promotion is the last step and the weakest one. It reorders tutors who have
 * already passed every gate; it can never add one who has not.
 */

/**
 * Sorts a promotion is allowed to influence.
 *
 * Only the default. "Best match" is the platform's own opinion about order,
 * and a promotion is the platform holding a different opinion — that is a
 * coherent thing to sell. Every other option is an instruction from the
 * visitor: somebody who asked for cheapest-first and got a promoted tutor at
 * the top has been handed a broken control, not an advertisement. So an
 * explicit sort is honoured exactly, and promotion stands down (§14).
 */
export const PROMOTABLE_SORTS = ["RELEVANCE"];

export function promotionAffectsSort(sort) {
  return PROMOTABLE_SORTS.includes(sort ?? "RELEVANCE");
}

/**
 * The Mongo filter that selects promotions live at `now`.
 *
 * Time is part of the query, never merely part of the stored status, so a
 * promotion whose window has closed stops affecting discovery the instant it
 * closes — whether or not the `promotion-expiry` job has run since (§41).
 */
export function livePromotionQuery(now = new Date()) {
  return {
    status: PROMOTION_STATUS.ACTIVE,
    startsAt: { $lte: now },
    endsAt: { $gt: now },
  };
}

/**
 * Split one page's worth of reads across the boosted block and the remainder.
 *
 * The combined ordering is: the boosted tutors, in their normal ranked order,
 * followed by everyone else, in their normal ranked order. Because the
 * remainder query *excludes* the boosted ids, the two lists are disjoint —
 * nobody is shown twice, and no result is skipped when a visitor pages on.
 * The total is unchanged by promotion, so page count and "N tutors found"
 * mean exactly what they meant before.
 *
 * @param {object} args
 * @param {number} args.promotedCount  Boosted tutors matching this search.
 * @param {number} args.page           1-based.
 * @param {number} args.pageSize
 * @returns {{promotedSkip:number, promotedLimit:number, normalSkip:number, normalLimit:number}}
 */
export function promotedPageSlice({ promotedCount, page, pageSize }) {
  const offset = Math.max(0, (page - 1) * pageSize);

  // How much of this page the boosted block covers.
  const promotedSkip = Math.min(offset, promotedCount);
  const promotedLimit = Math.max(0, Math.min(promotedCount - promotedSkip, pageSize));

  // The remainder picks up exactly where the boosted block stopped paying for
  // positions, so page two continues the list instead of repeating it.
  const normalSkip = Math.max(0, offset - promotedCount);
  const normalLimit = pageSize - promotedLimit;

  return { promotedSkip, promotedLimit, normalSkip, normalLimit };
}

/**
 * How many of the live promotions may actually be lifted in one result set.
 *
 * Two ceilings, both the operator's: `maxActive` bounds how many promotions
 * exist at once, and `maxPromotedPerSearch` bounds how many of them may crowd
 * a single page. The second is the one that matters to a visitor — it is what
 * keeps a page of search results a page of search results.
 */
export function promotionLimits(settings) {
  const promotions = settings?.promotions ?? {};
  return {
    enabled: promotions.enabled !== false,
    maxPromotedPerSearch: Math.max(0, promotions.maxPromotedPerSearch ?? 0),
    maxActive: Math.max(0, promotions.maxActive ?? 0),
  };
}
