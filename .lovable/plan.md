
## Fix the infinite loading screen on app startup

### What’s actually happening
The app is not rendering the home page because auth initialization gets stuck before `loading` is turned off.

- `App.tsx` blocks all protected routes while `loading === true`
- `AuthContext.tsx` starts with `loading = true`
- `supabase.auth.getSession()` is called without error handling
- the console/network logs show auth refresh requests failing with `AuthRetryableFetchError: Failed to fetch`
- when that promise rejects, `setLoading(false)` never runs, so the whole app stays on the `Loading...` screen forever

### Root cause
`src/contexts/AuthContext.tsx` only handles the success path for session recovery.  
A failed refresh/network error leaves auth state unresolved indefinitely.

### Implementation plan

**1. Harden auth initialization**
Update `src/contexts/AuthContext.tsx` so `getSession()` is wrapped in `try/catch/finally` (or `.catch(...).finally(...)`).

Behavior:
- if session loads successfully: keep current behavior
- if refresh/session recovery fails: set `session` to `null`
- always set `loading` to `false`

This ensures the app falls back to the login page instead of hanging.

**2. Keep the existing auth pattern**
Do not add aggressive local storage clearing or timeout hacks.  
Stay with the current standard auth flow:
- `onAuthStateChange`
- `getSession`
- graceful failure path

**3. Add lightweight auth error visibility**
Log the auth init failure clearly in `AuthContext` so future refresh failures are easier to diagnose without breaking the UI.

### Files to update
- `src/contexts/AuthContext.tsx`

### Expected result after fix
When session refresh succeeds:
- user goes into the app normally

When refresh fails or the old token is stale:
- loading screen ends
- user is treated as signed out
- protected routes redirect to `/auth`
- app no longer gets stuck on the blank loading screen

### Verification
1. Load the app with a valid session → home should render
2. Load the app with a stale/broken session → app should redirect to `/auth`, not stay on `Loading...`
3. Visit `/admin/scores` after sign-in → admin gate should still work normally
