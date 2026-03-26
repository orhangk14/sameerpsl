

## Plan: Auto-Sync, Real Players, Team Logos, Player Images & Team Builder

### Problems Identified
1. **Sync button visible to users** — data should auto-sync via scheduled cron jobs, not manual clicks
2. **No players showing** — the match detail page shows "No players found" because player sync hasn't run or players aren't linked
3. **No team logos** — just text abbreviations (LQ, IU, etc.) instead of real images
4. **No player images** — player cards show initials instead of photos from CricAPI
5. **`matches` table missing `lock_time` column** — the column doesn't exist in the DB schema despite being referenced in code

### Changes

#### 1. Set Up Automated Cron Sync (Database)
- Enable `pg_cron` and `pg_net` extensions
- Create three cron jobs:
  - **Every 6 hours**: call `sync-matches` to refresh schedule
  - **Every 6 hours**: call `sync-players` to refresh squads
  - **Every 30 seconds** (during live matches): call `sync-live-scores`
- This replaces the manual Sync button entirely

#### 2. Add `lock_time` Column to `matches`
- Migration: `ALTER TABLE matches ADD COLUMN IF NOT EXISTS lock_time timestamptz;`
- Default to `match_date` value

#### 3. Remove Sync Buttons from UI
- **Index.tsx**: Remove the Sync button from the hero section and the empty-state sync button. Keep only the auto-refreshing query + realtime subscription. On first load, if no matches exist, trigger sync automatically once (silently in background).
- **MatchDetail.tsx**: Remove "Sync Players" button. Auto-fetch players on mount if empty (silent background call).

#### 4. Add Real PSL Team Logos
- Store team logo URLs in a constant map using publicly available PSL team logo URLs (Wikipedia/official sources) or use high-quality SVG/PNG placeholders with team colors
- Create a `TeamLogo` component that renders the actual team logo image with fallback to abbreviation
- Update `MatchCard.tsx` and `MatchDetail.tsx` to use real logos

#### 5. Fix Player Images Display
- The `sync-players` edge function already fetches `playerImg` from CricAPI — verify it's storing correctly
- Update `PlayerCard.tsx` to properly render `image_url` with better fallback handling
- Ensure the `sync-players` function runs on first visit to a match (auto-trigger if no players found)

#### 6. Auto-Sync on First Load
- In `Index.tsx`: if matches query returns empty, automatically invoke `sync-matches` + `sync-players` in background (no button needed)
- In `MatchDetail.tsx`: if players list is empty, automatically invoke `sync-players` with the match_id

#### 7. Enhance Match Detail Team Building UX
- Ensure the team builder (player selection, captain/VC, save) works end-to-end
- Add a `unique(user_id, match_id)` constraint on `user_teams` if not present (needed for upsert)
- Make sure the "Build Team" flow is prominent when entering a match

### Files to Create/Edit
- **New migration**: `lock_time` column + cron jobs + unique constraint
- **`src/pages/Index.tsx`**: Remove sync buttons, add auto-sync on empty
- **`src/pages/MatchDetail.tsx`**: Remove sync button, auto-sync players, use team logos
- **`src/components/MatchCard.tsx`**: Add real team logo images
- **`src/components/TeamLogo.tsx`** (new): Reusable team logo component with image URLs
- **`supabase/functions/sync-players/index.ts`**: Ensure player images are fetched properly

### Technical Details
- Team logos will use a hardcoded map of team name → logo URL (using reliable CDN/Wikipedia sources)
- Cron jobs use `pg_cron` + `pg_net` to call edge functions on schedule
- Auto-sync uses `useEffect` with a one-time trigger when data is empty
- The `refetchInterval: 30000` on match queries already handles UI refresh

