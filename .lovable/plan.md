

## Fix: Admin page shows "Access Denied" before auth finishes loading

**Root cause:** The `AdminScores` component checks `isAdmin` immediately, but the `user` object is `null` while the auth session is still loading. Since there's no loading guard, it renders "Access Denied" before the user data arrives.

**Fix:** Import `loading` from `useAuth()` and show a spinner/skeleton while auth is loading, only checking admin status after loading completes.

**File:** `src/pages/AdminScores.tsx`

1. Destructure `loading` from `useAuth()` (line 35)
2. Add a loading guard before the `!isAdmin` check (before line 170):
   - If `loading` is true, render a simple loading spinner inside `<Layout>`
   - Only fall through to the admin check once loading is false

This is a 5-line change. No backend or database changes needed.

