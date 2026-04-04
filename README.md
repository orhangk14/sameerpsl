# Fantasy PSL

A live fantasy cricket platform for the Pakistan Super League (PSL) 2026 season. Users build fantasy teams of 11 players, assign a captain (2x) and vice-captain (1.5x), and earn points based on real match performance updated live via Cricbuzz scraping.

**Live at:** https://sameerpsl.vercel.app

## Features

- Live fantasy scoring updated every 60 seconds
- Real-time leaderboards via Supabase Realtime (WebSocket)
- Captain (2x) and Vice-Captain (1.5x) multipliers
- Teams lock at first ball (Cricbuzz In Progress detection)
- Automatic MOTM (+30) detection up to 6 hours post-match
- Private leagues
- Mobile-responsive design
- Email and Google OAuth authentication
- Zero-cost infrastructure (Supabase + Vercel free tiers)

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 18 + TypeScript + Vite |
| Styling | Tailwind CSS + shadcn/ui |
| State | TanStack React Query v5 + Supabase Realtime |
| Backend | Supabase (PostgreSQL + Edge Functions + Auth) |
| Scoring | Cricbuzz web scraping via Postgres http_get_text |
| Hosting | Vercel (frontend) + Supabase (backend) |
| Cron | cron-job.org (1-min intervals) |

## Fantasy Points System

### Batting

| Action | Points |
|--------|--------|
| Per run | +1 |
| Per four | +4 |
| Per six | +6 |
| Duck | -2 |
| 25 runs | +8 |
| 50 runs | +16 (additive) |
| 100 runs | +32 (additive) |
| SR > 170 (min 10 balls) | +6 |
| SR 150-170 | +4 |
| SR 130-150 | +2 |
| SR < 50 | -6 |

### Bowling

| Action | Points |
|--------|--------|
| Per wicket | +30 |
| Per maiden | +12 |
| 3 wickets | +4 |
| 4 wickets | +12 (additive) |
| 5 wickets | +28 (additive) |
| ER < 5 (min 2 overs) | +6 |
| ER > 12 | -6 |

### Fielding and Bonuses

| Action | Points |
|--------|--------|
| Catch | +8 |
| Stumping | +12 |
| Direct run out | +12 |
| Indirect run out | +6 |
| Starting XI | +4 |
| Winning team | +5 |
| Man of the Match | +30 |
| Captain | 2x total |
| Vice-Captain | 1.5x total |

## Team Selection Rules

- Budget: 100 credits
- Squad: 11 players (max 7 per team)
- Roles: WK 1-4, BAT 1-6, AR 1-4, BOWL 1-6
- Lock: Teams lock when match goes live (first ball, not toss)

## PSL 2026 Teams

| Team | Abbr | Colors |
|------|------|--------|
| Lahore Qalandars | LQ | Lime / Green |
| Karachi Kings | KK | Blue / Red |
| Islamabad United | IU | Red |
| Peshawar Zalmi | PZ | Yellow |
| Quetta Gladiators | QG | Purple |
| Multan Sultans | MS | Teal |
| Hyderabad Kingsmen | HK | Gold / Brown |
| Rawalpindi Pindiz | RP | Orange |

## Project Structure

    src/
    ├── pages/
    │   ├── Auth.tsx              # Login/signup
    │   ├── Index.tsx             # Match list
    │   ├── MatchDetail.tsx       # Team selection + live scores
    │   ├── Leaderboard.tsx       # Rankings
    │   ├── Leagues.tsx           # Private leagues
    │   ├── Profile.tsx           # User profile
    │   └── AdminScores.tsx       # Manual score entry
    ├── components/
    │   ├── TeamLogo.tsx          # Team logos + colors
    │   ├── PlayerCard.tsx        # Player selection cards
    │   └── Layout.tsx            # Page layout
    ├── hooks/
    │   └── use-realtimesubscription.ts
    ├── data/
    │   └── pslSquads.ts          # Fallback squad data
    └── integrations/
        └── supabase/             # Auto-generated types

    supabase/
    └── functions/
        ├── sync-live-scores/     # Main scoring engine
        ├── admin-update-scores/  # Manual score entry
        └── proxy-cricapi/        # API proxy

## Credits

Sameer Ahmed - Lead Developer and Design
- Frontend development and UI/UX
- Team selection interface
- Initial project setup
- Cricbuzz scraping engine

Orhan Ghazi Khan - Lead Architect and Infrastructure
- System architecture and database design
- Fantasy scoring logic
- Supabase Realtime migration
- DevOps, deployment and operations

## License

Proprietary - All Rights Reserved

Copyright 2026 Sameer Ahmed and Orhan Ghazi Khan.

This software is proprietary and confidential. No part of this software may be
reproduced, distributed, or transmitted in any form without prior written
permission. See LICENSE for full terms.

For licensing inquiries: orhanghazikhan@gmail.com
