

## Plan: Update PSL 2026 Squad Data (Trade Window + Withdrawals + Replacements)

### Overview
Update `src/data/pslSquads.ts` to reflect all trade window moves, withdrawals, and replacement signings.

### Changes to `src/data/pslSquads.ts`

**1. Add new players to `starPlayers` credits map:**
- Chris Green: 7, Daniel Sams: 8, Ryan Burl: 7.5, Usman Khawaja: 9, Maheesh Theekshana: 8, Shoriful Islam: 7.5, Brian Bennett: 7, Arafat Minhas: 7, Faisal Akram: 6.5

**2. Quetta Gladiators:**
- Remove: Spencer Johnson, Ahmed Daniyal, Jahanzaib Sultan
- Add: Alzarri Joseph (replaces Johnson), Ahmad Daniyal (traded from Multan — wait, Ahmad Daniyal moved TO Quetta), Jahanzaib Sultan (traded TO Quetta)
- Correction: Ahmad Daniyal and Jahanzaib Sultan moved TO Quetta from Multan. So they stay/get added to Quetta, removed from Multan.
- Remove: Spencer Johnson (pulled out)
- Add: Alzarri Joseph (replacement) — already in Quetta squad, so no change needed there

**3. Multan Sultans:**
- Remove: Ahmad Daniyal, Jahanzaib Sultan (traded to Quetta), Saad Masood (to Rawalpindiz)
- Add: Arafat Minhas, Faisal Akram (from Quetta), Mohammad Wasim Jr (from Islamabad), Shehzad Gul, Imran Randhawa, Mohammad Shahzad, Muhammad Ismail, Arshad Iqbal, Atizaz Habib Khan
- Note: Mohammad Shahzad, Muhammad Ismail, Arshad Iqbal are already listed — keep them. Add missing ones.

**4. Islamabad United:**
- Remove: Mohammad Wasim Jr (to Multan), Blessing Muzarabani (withdrew), Max Bryant (injured)
- Add: Salman Mirza, Nisar Ahmed (from Multan), Chris Green (replaces Bryant), Mohsin Riaz (late signing)

**5. Lahore Qalandars:**
- Remove: Gudakesh Motie (withdrew), Dasun Shanaka (withdrew — not in current list, skip), Ali Shabbir (injured — not in list, skip)
- Add: Dunith Wellalage (replaces Motie — already in squad, keep), Daniel Sams, Shahab Khan, Ryan Burl

**6. Karachi Kings:**
- Remove: Johnson Charles (not in current list — skip)
- Add: Reeza Hendricks (already present), Haroon Arshad (already present)
- No changes needed

**7. Rawalpindi Pindiz:**
- Remove: Zaman Khan (injured), Jake Fraser-McGurk (not in list — skip), Laurie Evans (dropped)
- Add: Saad Masood (from Multan), Jalat Khan, Cole McConchie (already present — keep), Usman Khawaja

**8. Hyderabad Kingsmen:**
- Remove: Ottneil Baartman (not in current list — skip)
- Add: Maheesh Theekshana

**9. Peshawar Zalmi:**
- Add: Farhan Yousuf, Shoriful Islam, Tanzid Hasan Tamim (already present — keep), Brian Bennett

### Summary of file changes
- **One file**: `src/data/pslSquads.ts` — update `starPlayers` credits map + modify each team's raw player arrays (remove withdrawn/traded players, add new signings)

### Also update database
- After updating the static file, the `players` table in the database should also be updated to reflect team changes for any players already stored. This can be done by re-running the sync-players function or by manually updating via the database insert tool.

