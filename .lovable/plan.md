

## Fix Admin Edge Function Auth and Recalculate Match Points

### Problem
1. The `admin-update-scores` edge function uses `anonClient.auth.getClaims()` which doesn't exist in the Supabase JS v2 SDK — it silently fails, preventing any admin actions (recalculate, manual saves) from working.
2. Because recalculation never ran with the new code, all `match_player_points.breakdown` values are NULL — no batting/bowling/fielding breakdown chips appear in the UI.
3. The C/VC multiplied totals in `user_teams.total_points` ARE correctly stored from the original sync, and the UI code in `LiveMyTeam` does apply multipliers correctly. The visual issue is likely that breakdowns are missing so users can't verify the math.

### Plan

**1. Fix edge function auth** (`supabase/functions/admin-update-scores/index.ts`)
- Replace `getClaims(token)` with `getUser(token)` which is the correct Supabase JS v2 method
- Extract email from `user.email` instead of `claims.email`

```typescript
// Before (broken):
const { data: claimsData, error: claimsError } = await anonClient.auth.getClaims(token);
const userEmail = claimsData.claims.email;

// After (correct):
const { data: { user: authUser }, error: authError } = await anonClient.auth.getUser(token);
const userEmail = authUser?.email;
```

**2. After deploying**, the admin can navigate to `/admin/scores`, select each completed match, and click "Recalculate from Cricbuzz" to populate breakdowns, apply win bonuses, and refresh all user team totals.

### Files to change
- `supabase/functions/admin-update-scores/index.ts` — fix auth from `getClaims` to `getUser` (~5 lines)

### What this unblocks
- Admin panel becomes functional (save scores, recalculate, retry sync)
- Recalculating the 2 completed matches will populate `breakdown` JSON, making batting/bowling/fielding/bonus chips visible in the UI
- Existing C/VC multiplier logic in both backend and UI is already correct and does not need changes

