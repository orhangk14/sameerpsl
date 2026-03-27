

## Plan: Fix Missing Profile & Improve Team Visibility

### Investigation Results
The logged-in user (`samspamspamsam16@gmail.com`) genuinely does **not** have a team saved for the live Quetta vs Karachi match. They have teams for Multan vs Islamabad and Peshawar vs Rawalpindi only. The "You didn't create a team" message is technically correct.

Additionally, this user has **no profile record** — the `handle_new_user` trigger likely failed during signup.

### Root Causes
1. **No visual indicator on match cards** showing which matches already have a saved team — easy to lose track
2. **Missing profile** for some users when the trigger fails silently
3. **No helpful guidance** when viewing a live match without a team

### Changes

#### 1. Add "Team Created ✓" badge on match cards (`src/pages/Index.tsx`)
- Query all `user_teams` for the logged-in user
- Show a small green "✓ Team" badge on match cards where a team exists
- Helps users instantly see which matches they've prepared for

#### 2. Auto-create missing profile in AuthContext (`src/contexts/AuthContext.tsx`)
- After auth state resolves, check if profile exists
- If not, insert one using the user's email prefix as username
- Prevents silent profile creation failures from breaking the app

#### 3. Improve "no team" message on live matches (`src/pages/MatchDetail.tsx`)
- Change "You didn't create a team for this match" to something more helpful
- Add context like "Teams must be created before the match starts"

### Files

| Action | File | What |
|--------|------|------|
| Edit | `src/pages/Index.tsx` | Add "Team Created" badge on match cards |
| Edit | `src/contexts/AuthContext.tsx` | Auto-create missing profile on login |
| Edit | `src/pages/MatchDetail.tsx` | Improve no-team message for live matches |

