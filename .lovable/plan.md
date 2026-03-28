

## Add admin email

**File:** `src/pages/AdminScores.tsx` (line 17)

Add `samspamspamsam16@gmail.com` to the `ADMIN_EMAILS` array:

```typescript
const ADMIN_EMAILS = ['admin@psl.com', 'sameer@psl.com', 'samspamspamsam16@gmail.com'];
```

Also update the same whitelist in `supabase/functions/admin-update-scores/index.ts` if it has a server-side check.

