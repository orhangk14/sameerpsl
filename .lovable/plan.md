
## Fix persistent startup loading caused by stale auth refresh

### What I found
- The previous auth fix is already present in `src/contexts/AuthContext.tsx` (`catch` + `finally` around `getSession()`).
- Despite that, the app still gets stuck on the app-level `Loading...` screen because route guards in `src/App.tsx` still block both `/` and `/auth` while `loading === true`.
- Network logs show repeated refresh-token requests returning `504 upstream request timeout` / `Failed to fetch`.
- That means the real issue is no longer “missing error handling”; it is that auth session recovery can hang or retry long enough that the app never leaves the loading gate.

### Root cause
A stale/broken stored session is triggering refresh-token recovery during startup.  
While that recovery is hanging/failing, `AuthProvider` keeps `loading` true, and both `ProtectedRoute` and `AuthRoute` render the full-screen loading state instead of letting the user reach `/auth`.

### Implementation plan

**1. Harden auth initialization against hanging refreshes**  
Update `src/contexts/AuthContext.tsx` so startup auth recovery is bounded:
- keep the current `onAuthStateChange + getSession` pattern
- wrap session initialization in a small timeout/failsafe
- if session recovery hangs or throws, treat the user as signed out
- always resolve `loading` to `false`

Recommended behavior:
- start listener first
- race `getSession()` against a short timeout
- on timeout/error, clear only the local session state and proceed unauthenticated

**2. Clear broken local auth state without relying on the network**  
When startup recovery fails, call a local-only sign-out/cleanup path so the app stops retrying the same bad refresh token on every render/load.
- local cleanup only
- no aggressive storage hacks
- no await inside `onAuthStateChange`

This should let the app fall through to `/auth` immediately instead of staying on the loading overlay.

**3. Keep route guards simple**
`src/App.tsx` can stay mostly as-is once auth initialization reliably settles:
- authenticated user → protected pages
- unauthenticated user → `/auth`
- loading shown only during a short, bounded startup window

**4. Add lightweight diagnostics**
Keep a clear console log for:
- auth init timeout
- auth init failure
- local session cleanup triggered

This will make future auth issues much easier to distinguish from page/query loading.

### Files to update
- `src/contexts/AuthContext.tsx`
- possibly `src/App.tsx` only if a small guard/refactor is needed after auth readiness is separated from session state

### Expected result
- If refresh succeeds: user enters the app normally
- If refresh token is stale/broken: app stops waiting, clears the bad local session, and routes to `/auth`
- `/auth` becomes reachable again instead of being blocked behind infinite loading

### Verification
1. Load with a valid session → app opens normally  
2. Load with a stale/broken session → app reaches `/auth` instead of hanging  
3. Refresh several times after a failed auth recovery → no repeated infinite loading loop  
4. Sign in again after fallback → normal navigation resumes, including `/admin/scores`
