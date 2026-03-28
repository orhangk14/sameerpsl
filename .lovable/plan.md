

## Plan: Fix Loading Screen Hang on Database Timeout

### Problem
The `AuthProvider` in `src/contexts/AuthContext.tsx` calls `supabase.auth.getSession()` on mount. If the backend is slow or timing out, this call hangs indefinitely, keeping `loading = true` and the app stuck on "Loading...".

### Solution
Add a timeout fallback to the auth initialization so that after ~5 seconds, loading is set to `false` regardless. The user will be redirected to the auth page (since `session` will be null), where they can retry.

### Changes

**1. `src/contexts/AuthContext.tsx`**
- Add a `setTimeout` that sets `loading = false` after 5 seconds as a fallback
- Clear the timeout when auth resolves normally
- This ensures the app never hangs indefinitely on the loading screen

