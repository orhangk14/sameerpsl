
## Fix the startup loading screen that still never resolves

### Do I know what the issue is?
Yes. The timeout fallback in `src/contexts/AuthContext.tsx` is still awaiting another auth call, so `loading` can remain `true` forever.

### What I found
- `AuthContext.tsx` already races `supabase.auth.getSession()` against a 5s timeout.
- But the timeout/error handler is `async` and does `await supabase.auth.signOut({ scope: 'local' })`.
- If the auth client is frozen by the same stale refresh-token problem, that local sign-out can hang too.
- Because `.catch(async ...)` stays pending, `.finally(() => setLoading(false))` never runs.
- `src/App.tsx` blocks both `/` and `/auth` whenever `loading` is true, so the app stays on the full-screen `Loading...` state.
- The auth logs match this exactly: repeated `/token` refresh timeouts and 500/504 errors during session recovery.

### Plan
1. **Make auth initialization finish independently of cleanup**
   - Refactor `src/contexts/AuthContext.tsx` so startup always reaches a single `finishInit()` path.
   - On timeout/error, set `session` to `null` and `loading` to `false` immediately.

2. **Remove awaited auth cleanup from the critical path**
   - Do not await `supabase.auth.signOut({ scope: 'local' })` inside the timeout handler.
   - Use best-effort local cleanup after the UI is already unblocked.
   - If needed, clear only the app’s stored auth session key(s), not all browser storage.

3. **Prevent races between auth listener and timeout**
   - Add a small guard (`initialized` / `mounted` ref) so `onAuthStateChange`, timeout fallback, and successful `getSession()` cannot fight each other.
   - Keep `onAuthStateChange` synchronous with state updates only.

4. **Harden the same auth pattern on reset flow**
   - `src/pages/ResetPassword.tsx` also calls `getSession()` without protection.
   - Add the same bounded session recovery there so it cannot hang on “Verifying reset link...”.

### Files to update
- `src/contexts/AuthContext.tsx`
- `src/pages/ResetPassword.tsx`
- `src/App.tsx` only if a tiny guard refactor is needed

### Expected result
- Valid session: app loads normally.
- Stale/broken session: loading ends quickly, local stale auth is cleared, and the app falls through to `/auth`.
- Reset-password flow also fails fast instead of hanging forever.

### Technical details
```text
Revised startup flow:
1. subscribe to auth changes
2. start getSession() with timeout
3. if success -> set session -> finish init
4. if timeout/error -> set session null -> finish init immediately
5. run cleanup as best-effort background work
```
