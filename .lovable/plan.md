

## Plan: Auto Status Transition, Player Alias Table & Scraping Reliability

### 1. Auto Upcoming → Live Status Transition

**Problem**: Matches stay "upcoming" until manually changed, so `sync-live-scores` never picks them up.

**Fix**: At the top of `sync-live-scores/index.ts`, before querying for live matches, run an UPDATE to auto-transition matches whose `match_date` has passed:

```sql
UPDATE matches SET status = 'live'
WHERE status = 'upcoming' AND match_date <= now()
```

Then query for `status IN ('live')` as before. This means the cron job (already running every minute) will automatically start tracking matches when their scheduled time arrives.

**File**: `supabase/functions/sync-live-scores/index.ts` — add ~3 lines before the live matches query (line 50)

---

### 2. Player Alias Mapping Table

**Problem**: Scorecard names vary across sources (e.g., "M Rizwan" vs "Mohammad Rizwan" vs "Muhammad Rizwan"). Current fuzzy matching with `normalizeName` misses these.

**Fix**:
- **New migration**: Create `player_aliases` table:
  ```sql
  CREATE TABLE player_aliases (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    player_id uuid NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    alias text NOT NULL,
    UNIQUE(alias)
  );
  ALTER TABLE player_aliases ENABLE ROW LEVEL SECURITY;
  CREATE POLICY "Aliases viewable by everyone" ON player_aliases FOR SELECT USING (true);
  CREATE POLICY "Service role manages aliases" ON player_aliases FOR ALL TO service_role USING (true);
  ```
- **Seed common aliases**: Insert known variations for PSL players (e.g., "M Rizwan" → Mohammad Rizwan's player_id, "Shaheen" → Shaheen Shah Afridi's player_id)
- **Update `computePlayerPoints`** in `sync-live-scores/index.ts`: After failing to match by normalized name, check the `player_aliases` table as a fallback lookup

**Files**:
| Action | File |
|--------|------|
| Migration | New `player_aliases` table |
| Edit | `supabase/functions/sync-live-scores/index.ts` — load aliases, use in player matching |

---

### 3. Improve Cricbuzz Scraping Reliability

**Problem**: The current Cricbuzz scraper uses fragile regex on HTML that may not match the actual page structure. The ESPN endpoint (`/matches/engine/match/{id}.json`) is deprecated.

**Fix for Cricbuzz**:
- Switch from the HTML scorecard URL to the **Cricbuzz JSON API** endpoint: `https://www.cricbuzz.com/api/html/cricket-scorecard/{id}` returns structured data that's more parseable
- Use a more robust approach: fetch the **mini-scorecard JSON** from `https://www.cricbuzz.com/match-api/{id}/commentary.json` which returns structured innings data
- Add proper User-Agent header to avoid blocks
- Parse the JSON structure instead of regex on HTML

**Fix for ESPN**:
- Update to the current ESPN Cricinfo API format: `https://hs-consumer-api.espncricinfo.com/v1/pages/match/details?lang=en&seriesId={seriesId}&matchId={matchId}`
- Or use the simpler summary endpoint: `https://hs-consumer-api.espncricinfo.com/v1/pages/match/scoreboard?lang=en&matchId={matchId}`
- These return well-structured JSON with innings, batting, bowling arrays

**Files**:
| Action | File |
|--------|------|
| Edit | `supabase/functions/sync-live-scores/index.ts` — rewrite `tryCricbuzz()` and `tryESPN()` functions |

---

### Summary of All Changes

| Action | File | What |
|--------|------|------|
| Edit | `supabase/functions/sync-live-scores/index.ts` | Auto-transition upcoming→live; load aliases for matching; rewrite Cricbuzz/ESPN scrapers |
| Migration | `player_aliases` table | New table for name alias lookups |
| Data insert | Seed ~30-40 common PSL player aliases | Known name variations |

### Technical Notes
- The auto-transition runs inside the existing cron job — no new cron needed
- Aliases are checked only when the primary normalized-name match fails, so no performance impact for already-matched players
- Cricbuzz and ESPN rewrites maintain the same `NormalizedScorecard` return type, so downstream code (points calc, leaderboard) is unchanged

