

## Add error handling and retry UI for matches loading

### Problem
The Supabase REST API requests are intermittently failing with `net::ERR_ABORTED`, causing the app to show "Loading matches..." forever. The database is healthy (44 matches, correct RLS), but the app has zero error handling — no retry button, no error message, just an infinite spinner.

### Plan

**File: `src/pages/Index.tsx`**

1. Extract `isError` and `refetch` from the `useQuery` hook
2. Replace the loading-only state with a combined loading/error UI:
   - On error: show a message like "Couldn't load matches" with a **Retry** button that calls `refetch()`
   - Keep the spinner for the initial loading state
3. Add `retry: 3` to the query config (react-query default, but make it explicit) so transient failures auto-recover before showing the error state

### Technical details
- Add `isError` and `refetch` destructuring from `useQuery`
- In the render, after the `isLoading` check, add an `isError` branch with a retry button
- The 30s `refetchInterval` already handles background recovery, but the error UI gives users immediate control

### Expected result
- Transient API failures: react-query retries 3 times automatically, then shows error with retry button
- User can tap Retry to immediately re-fetch
- Background polling continues to auto-recover
- No more infinite "Loading matches..." on API errors

