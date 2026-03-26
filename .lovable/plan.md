

## Plan: Fix Player Loading & Remove CricAPI Dependency

### Root Cause
The `players` table has **0 rows**. CricAPI is permanently blocked from edge functions (connection reset). The current code waits for the sync attempt to finish before showing anything — that's why it's stuck on "Loading players."

The fallback data in `pslSquads.ts` already has correct squads for all 8 PSL teams. The fix is to **show fallback players immediately** without waiting for the doomed sync attempt.

### Changes

#### 1. Fix loading logic in `MatchDetail.tsx`
- Change `isStillLoading` to only depend on `playersLoading` (the DB query), not on `syncDone`
- Show fallback players instantly when DB returns empty — don't block on the background sync
- Move the sync attempt to fire-and-forget (keep it, but never block UI on it)
- Remove the 2-second artificial delay after sync

#### 2. Update PSL squad data in `pslSquads.ts`
- Cross-check and correct player names/roles for the actual PSL 2026 season rosters (the current data has some players on wrong teams or retired players)
- Ensure team names match exactly what's in the `matches` table: "Quetta Gladiators", "Karachi Kings", "Lahore Qalandars", "Islamabad United", "Peshawar Zalmi", "Multan Sultans", "Hyderabad Kingsmen", "Rawalpindi Pindiz"

#### 3. Remove blocking sync from page load
- Keep the background sync as opportunistic (in case CricAPI starts working), but never show a spinner waiting for it
- If DB players exist, use them; if not, use fallback instantly

### Files to Edit
- **`src/pages/MatchDetail.tsx`** — fix `isStillLoading` logic, remove sync blocking
- **`src/data/pslSquads.ts`** — verify/correct squad data

### Technical Details
- The key line change: `const isStillLoading = playersLoading;` (remove `|| (!syncDone && dbPlayers.length === 0)`)
- Fallback players are already wired up via `allPlayers` useMemo — they just need to not be hidden behind the loading spinner
- No new APIs needed — Google doesn't have a public cricket API, and web scraping is unreliable. The hardcoded fallback is the most reliable approach for a fantasy league with known teams.

