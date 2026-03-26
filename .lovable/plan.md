

## Plan: Improve Leaderboard UI, Match Ordering & 48-Hour Filter

### Current Issues (from screenshot)
- All matches show "Tbc vs Tbc" — team names are truncated or placeholder data
- Matches ordered by `match_date DESC` (latest first) — should be earliest first
- No 48-hour filter — all 20 matches shown regardless of date
- Horizontal scrollbar visible and ugly on match selector
- Overall tab looks plain — top 3 need more visual distinction
- Match selector pills are cramped and hard to scan

### Changes to `src/pages/Leaderboard.tsx`

**1. Match query — earliest first + 48-hour window**
- Change ordering to `ascending: true` (earliest game first)
- Add a date filter: only fetch matches where `match_date` is within the next 48 hours from now (using `.lte()` and `.gte()`)
- Also include live/completed matches from the last 24 hours so recent results are still visible

**2. Match selector pills — better UI**
- Show match date/time below team names (e.g., "Mar 27, 7:00 PM")
- Use vertical card-style buttons instead of cramped horizontal pills
- Hide the scrollbar with proper CSS (`no-scrollbar` utility)
- Auto-select the first match when the tab is opened

**3. Overall tab — enhanced top 3**
- Rank 1: gold gradient with crown/trophy icon
- Rank 2: silver tint  
- Rank 3: bronze tint
- Add rank number alongside the medal icon for clarity
- Add subtle entry count text at the bottom

**4. Entry rows — polish**
- Add avatar initial circle for each user
- Slightly larger padding and better spacing
- Smoother expand/collapse animation for squad view

### Technical Details
- Import `format, addHours, isAfter, isBefore` from `date-fns`
- Filter matches client-side after fetch: `matches.filter(m => new Date(m.match_date) <= addHours(new Date(), 48))` for upcoming, plus include live/completed from last 24h
- Sort ascending by `match_date`
- Auto-select first match via `useEffect` when matches load and no match is selected

### Files
| Action | File |
|--------|------|
| Edit | `src/pages/Leaderboard.tsx` — all UI and query changes |

