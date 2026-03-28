
## Plan: Fix auth getting stuck on the sign-in screen

### What is actually happening
This is not just the initial app loader anymore.

From the logs and replay:
- the user is on `/auth`
- clicking **Sign In** changes the button to `Loading...`
- auth requests to the backend are failing with `Failed to fetch`
- the request failing is a token refresh call, which means the app is trying to use a persisted local session/refresh token and gets stuck in the auth client flow

So the current 5-second fallback only helps the app leave the global startup loader. It does **not** fix the login form itself when `signInWithPassword()` or session refresh hangs/fails.

### Root cause
There are two likely contributors working together:

1. **Broken persisted auth state in local storage**
   - the client keeps trying to refresh an old session token
   - that refresh fails before auth settles cleanly

2. **No timeout/recovery path in the login form**
   - `Auth.tsx` sets local `loading=true`
   - if the auth call hangs or retries internally, the button stays stuck on `Loading...`

### Implementation approach

#### 1. Make auth initialization recover from broken persisted sessions
Update `src/contexts/AuthContext.tsx` so that when initial session retrieval/refresh fails or times out, it does more than just `setLoading(false)`:
- clear the broken local auth state
- reset `session` to `null`
- stop loading deterministically
- avoid leaving the app in a half-authenticated state

This should use a **non-blocking recovery path**, not async work inside the auth state listener.

#### 2. Add a safe timeout wrapper for auth form actions
Update `src/pages/Auth.tsx`:
- wrap `signInWithPassword`, `signUp`, and `resetPasswordForEmail` in a timeout guard
- if the request does not complete in time, stop the button spinner and show a clear error message
- on auth fetch failure, clear the stale local session before allowing retry

That prevents the login form from hanging forever.

#### 3. Separate “auth ready” from “submitting”
Right now there is:
- global auth loading in `AuthContext`
- local form loading in `Auth.tsx`

I’ll make sure they are handled independently so:
- the auth page always renders once auth bootstrap is done
- the submit button only stays loading for the active request
- failed refreshes cannot block the page indefinitely

#### 4. Make the auth page resilient to refresh-token failures
Add explicit handling for network/auth retry failures:
- detect `Failed to fetch` / auth fetch errors
- show a user-facing retry message
- recover local auth state so the next sign-in attempt starts cleanly

#### 5. Keep `onAuthStateChange` non-blocking
The current listener is close to correct, but I’ll tighten the pattern:
- no awaited work in the listener
- defer profile creation/sync outside the callback
- ensure listener updates state immediately and never participates in deadlocks

### Files to update
- `src/contexts/AuthContext.tsx`
- `src/pages/Auth.tsx`

### Expected result
After this change:
- the app should no longer stay stuck on `Loading...`
- the sign-in button should recover if auth/network refresh fails
- stale local session data should no longer poison new login attempts
- users should either sign in successfully or get a clear retryable error instead of an infinite spinner

### Technical note
The logs point to auth refresh failure, not a leaderboard or match-data issue. The fix should focus on **session recovery + timeout handling**, not on routes or fantasy scoring logic.
