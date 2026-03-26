

## Plan: Fix Scrolling, Match Grouping, Logos, Players & Live Scores

### Problems Found
1. **Scroll cutoff**: Layout uses `pt-18` which isn't a standard Tailwind class — content gets hidden behind the fixed navbar. No `ScrollToTop` component exists.
2. **No match grouping**: All upcoming matches shown in a flat list. Need "Next 48 Hours" vs "Later" sections.
3. **Team logos not visible**: Wikipedia URLs are blocked by hotlink protection. Also missing logos for new teams: Hyderabad Kingsmen (HK), Rawalpindi Pindiz (RP).
4. **0 players in database**: The `players` table is completely empty — `sync-players` edge function likely failed silently due to the same CricAPI connectivity issue. Players and their images can't show if they don't exist.
5. **Live score display is minimal**: Just shows score text, no visual emphasis or real-time feel.

### Changes

#### 1. Fix Scroll Issues
- **`Layout.tsx`**: Change `pt-18` to `pt-16` (valid Tailwind, matches h-14 navbar + gap)
- **New `ScrollToTop.tsx`**: Create component that scrolls to top on route change
- **`App.tsx`**: Add `ScrollToTop` inside `BrowserRouter`

#### 2. Group Upcoming Matches (Index.tsx)
- Split "Upcoming" tab into two sections:
  - **"Next 48 Hours"** — matches within the next 2 days, shown prominently
  - **"Coming Up Later"** — remaining upcoming matches, slightly muted
- Use `date-fns` `isWithinInterval` / `addDays` for the split

#### 3. Fix Team Logos (TeamLogo.tsx)
- Replace Wikipedia URLs with reliable `i.imgur.com` or `cricapi` image URLs that aren't hotlink-blocked
- Add entries for **HK** (Hyderabad Kingsmen) and **RP** (Rawalpindi Pindiz) with brand colors
- Add proper `onError` fallback that shows the colored abbreviation circle when image fails

#### 4. Fix Player Sync — Client-Side Fallback
Since the edge function can't reach CricAPI (connection reset), add a **client-side proxy approach**:
- **New edge function `proxy-cricapi`**: A thin proxy that the browser calls with the CricAPI endpoint path. The function fetches from CricAPI and returns the data. This may work better than the cron-triggered version since the edge function infrastructure may have intermittent connectivity.
- **Update `sync-players`**: Add a fallback mode where if CricAPI is unreachable, the function accepts player data in the request body (posted from the client after the client fetches via proxy).
- **`MatchDetail.tsx`**: If players are empty after auto-sync attempt, try fetching squad data client-side via the proxy and posting it to `sync-players`.

#### 5. Enhance Live Score Display (MatchCard.tsx)
- For live matches: add pulsing green dot, animated score display, show overs prominently
- Add a live score banner section with team colors
- Show "Match Status" text from API (e.g., "Day 1 - Session 2", "Innings Break")

#### 6. Better Player Card Images (PlayerCard.tsx)  
- Ensure `AvatarImage` has proper error handling
- Add a loading skeleton while image loads
- Use CricAPI player image URLs which come as `https://h.cricapi.com/img/icon/{id}.jpg`

### Files to Create/Edit
- **Create** `src/components/ScrollToTop.tsx`
- **Edit** `src/App.tsx` — add ScrollToTop
- **Edit** `src/components/Layout.tsx` — fix padding
- **Edit** `src/pages/Index.tsx` — add match grouping (Next 48h / Later)
- **Edit** `src/components/TeamLogo.tsx` — fix logo URLs, add HK/RP teams
- **Edit** `src/components/MatchCard.tsx` — enhance live score display
- **Edit** `src/components/PlayerCard.tsx` — improve image handling
- **Create** `supabase/functions/proxy-cricapi/index.ts` — client-side API proxy
- **Edit** `src/pages/MatchDetail.tsx` — client-side player sync fallback

### Technical Details
- Match grouping uses `addDays(new Date(), 2)` from date-fns to split upcoming matches
- Team logos will use direct CricAPI team image URLs (`https://h.cricapi.com/img/icon/{teamId}.jpg`) or reliable fallback colored circles with proper abbreviations
- The proxy edge function simply forwards requests to `api.cricapi.com` with the stored API key, avoiding CORS issues on the client
- ScrollToTop uses `useEffect` + `useLocation` to call `window.scrollTo(0, 0)` on path change

