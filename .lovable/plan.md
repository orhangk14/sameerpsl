

## Fix: Sync completed matches from Cricbuzz and update leaderboard

### Problem
Both live matches have `cricbuzz_match_id = null`, so the sync function skips Cricbuzz entirely. The auto-discovery fails because the team keyword map has "Rawalpindi" mapped to "raiders" instead of "pindiz". Additionally, there are 0 player points recorded and 32 user teams waiting for scoring.

### Plan

**1. Fix team keyword mapping in sync-live-scores edge function**
Update `PSL_TEAM_KEYWORDS` to include "pindiz" for Rawalpindi so discovery can match "Rawalpindi Pindiz" in Cricbuzz slugs:
```
"Rawalpindi": ["rawalpindi", "raiders", "pindiz"],
```

**2. Redeploy and invoke sync-live-scores**
After fixing the keyword mapping, invoke the edge function which will:
- Discover Cricbuzz match IDs from the live scores page
- Fetch full scorecards for both matches
- Compute player fantasy points from batting/bowling/fielding stats
- Mark matches as "completed" with final scores and winning teams
- Recalculate all 32 user team totals and profile leaderboard points

**3. Add a manual "Retry Sync" button on AdminScores page**
As a fallback for when automated sync fails, add a button that invokes `sync-live-scores` on demand so you don't have to wait for the cron job.

**4. Verify results**
- Confirm both matches show "completed" with scores
- Confirm match_player_points has entries for both matches
- Confirm user_teams have recalculated total_points
- Confirm leaderboard reflects updated standings

### Why this should work
The `http_get_text` RPC (PostgreSQL HTTP extension) has been proven to work for Cricbuzz scraping. The only blocker was the missing cricbuzz_match_id, which the discovery function couldn't find due to the team name mismatch.

