# Bound performance feedback and repair titles without changing facts

## Context

DIEM has enough published Reels to begin measuring repeated performance patterns,
but most V2 ledgers do not yet contain comparable insight windows. Several useful
economy articles were also discarded after both editorial model calls produced no
valid 14-character two-line cover title, while the ledger retained only a generic
error.

## Decision

- Build a ledger-native report that keeps 24h, 72h, and 7d windows separate.
- Preserve late cumulative backfills but exclude them from observation-window
  comparisons and the publishing prior.
- Require five category samples and three feature samples before learning a signal.
- Apply any learned performance prior only after hard editorial gates pass and cap
  it between -6 and +8 points.
- When an otherwise grounded model response fails only its title contract, call the
  same model once for title-only repair with the article frame and accepted caption
  locked. Keep the caption unchanged.
- If repair and both models fail, advance to the next article candidate as before.
- Preserve per-model and title-repair diagnostics in the publication ledger.

## Consequences

The pipeline can learn from repeated evidence without overfitting a viral outlier,
and useful articles are no longer discarded solely because one full editorial call
wrote an overlong cover title. One extra model call is possible only on title-only
failure.

## Rejected alternatives

- Relax the 14-character cover contract globally: this hides the actual generation
  failure and can make the cover unreadable.
- Deterministic title or caption fallback: prior incidents showed it can publish
  misleading or source-like text.
- Hard topic blacklists from one low-performing Reel: the sample is too noisy.

## Status

Accepted.
