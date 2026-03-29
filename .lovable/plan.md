

## Fix Missing Per-Match Points for Ahmad Daniyal & Farhan Yousuf

### Problem
The aliases were added correctly, but recalculation was only run on one match. Two matches are still missing points:

| Player | Missing Match | Match ID |
|--------|--------------|----------|
| Ahmad Daniyal (Quetta) | Quetta vs Hyderabad | `bf0ef35b-bbf0-4afb-83d0-1e28e848d179` |
| Farhan Yousuf (Peshawar) | Peshawar vs Rawalpindi | `e1b40bf5-96bb-408a-9d55-0e553068ac93` |

The scoring engine logic is correct — each match stores separate `match_player_points` rows, and `players.points` is the sum across all matches. The `mergePlayer` function only merges stats within a single scorecard (batting + fielding for the same player), which is the correct behavior.

### Plan

**Step 1 — Trigger recalculation for the 2 missing matches**

Call the `admin-update-scores` edge function with `recalculate: true` for each missing match. This will:
- Re-scrape the Cricbuzz scorecard
- Resolve "Ahmed Daniyal" and "Farhan Yousaf" via the alias table
- Create separate `match_player_points` rows with per-match breakdowns
- Update global `players.points` as the correct sum
- Recalculate user team totals and profile leaderboard points

**Step 2 — Verify the results**

After recalculation, query the database to confirm:
- Ahmad Daniyal has **2 separate** match_player_points rows (one per match) with correct breakdowns
- Farhan Yousuf has **1** match_player_points row with correct breakdown
- Global `players.points` equals the sum of individual match points
- User team totals and profile leaderboard points are updated correctly

### No code changes needed
The scoring engine already handles per-match isolation correctly. This is purely a data operation — triggering recalculation on the matches that were missed.

