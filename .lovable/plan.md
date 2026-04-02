

## Defer Fantasy Point Calculations Until Match Completion

### Problem
Every minute during a live match, the `sync-live-scores` function scrapes Cricbuzz (2 HTTP calls via `http_get_text` RPC), parses all player stats, computes fantasy points for every player, then recalculates every user team's total and profile points. This hammers the database with dozens of writes per invocation, causing 504 upstream timeouts that take down the entire app (auth, match loading, everything).

### Solution
During live matches, **only update the display scores** (team_a_score, team_b_score, status). Defer all heavy work (player point computation, user team recalculation) to when the match transitions to `completed`.

### Changes

**File: `supabase/functions/sync-live-scores/index.ts`**

In the main handler loop (lines ~120-163), split behavior based on match completion:

1. **While match is live** — only update `team_a_score`, `team_b_score`, and `status` on the `matches` table. Skip `computePlayerPoints()` and `recalcUserTeamPoints()` entirely. Also skip the scorecard page fetch (`/live-cricket-scorecard/`) since it's only needed for full player stats — just fetch the live scores page for display scores.

2. **When match ends** (`scorecard.matchEnded === true`) — run the full pipeline: fetch scorecard, compute player points, apply win bonus and MOTM bonus, recalculate user team points and profile totals. This happens exactly once per match.

3. **Skip Playing XI update during live** — the `updatePlayingXI` call can also be deferred or run only once at match start, not every minute.

### Specific code changes

```text
Current flow (every minute during live):
  fetch live scores page  ─┐
  fetch scorecard page     ─┤  2 heavy HTTP calls
  parse all players        ─┘
  update match scores      ── 1 DB write
  computePlayerPoints()    ── N DB writes (one per player)
  recalcUserTeamPoints()   ── M DB writes (one per user team + profiles)

New flow during live:
  fetch live scores page   ── 1 HTTP call (lighter page)
  update match scores      ── 1 DB write
  DONE

New flow when match completes:
  fetch scorecard page     ── 1 HTTP call
  parse all players        
  update match scores + winning_team
  computePlayerPoints()    ── full calculation with bonuses
  recalcUserTeamPoints()   ── full recalc
```

### Implementation detail

In `tryCricbuzz()` (line ~298), add a parameter or return early from scorecard fetch when we only need display scores. The simplest approach: add a `scoresOnly` boolean parameter. When true, skip the scorecard page fetch and return with empty `players` array (scores + matchEnded status only).

In the main loop, the logic becomes:
```
// First pass: get scores and check if match ended
scorecard = await tryCricbuzz(id, match, supabase, /* scoresOnly */ true);
// Update display scores
await updateMatchScores(match.id, scorecard);

// Only do heavy work if match just completed
if (scorecard.matchEnded) {
  fullScorecard = await tryCricbuzz(id, match, supabase, /* scoresOnly */ false);
  await computePlayerPoints(supabase, fullScorecard, match.id, aliasMap);
  await recalcUserTeamPoints(supabase, match.id);
}
```

### Expected result
- Live matches: app stays responsive (1 light HTTP call + 1 DB write per minute)
- Match completion: full points calculated once, correctly, with MOTM and win bonus
- No more app-wide 504 outages during games
- Admin recalculate button still works independently for manual corrections

