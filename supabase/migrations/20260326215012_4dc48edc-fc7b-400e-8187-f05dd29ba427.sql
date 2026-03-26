
-- 1. Create match_player_points table for per-match isolated scoring
CREATE TABLE public.match_player_points (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id uuid NOT NULL REFERENCES public.matches(id) ON DELETE CASCADE,
  player_id uuid NOT NULL REFERENCES public.players(id) ON DELETE CASCADE,
  points integer NOT NULL DEFAULT 0,
  UNIQUE(match_id, player_id)
);

ALTER TABLE public.match_player_points ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Match player points viewable by everyone"
ON public.match_player_points FOR SELECT TO public USING (true);

CREATE POLICY "Service role can manage match_player_points"
ON public.match_player_points FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Allow anon/authenticated to insert/update for edge function via service role
CREATE POLICY "Anyone can insert match_player_points"
ON public.match_player_points FOR INSERT TO public WITH CHECK (true);

CREATE POLICY "Anyone can update match_player_points"
ON public.match_player_points FOR UPDATE TO public USING (true);

-- 2. Add unique constraint on players(name, team) for upsert
ALTER TABLE public.players ADD CONSTRAINT players_name_team_unique UNIQUE (name, team);

-- 3. Enable realtime on user_teams
ALTER PUBLICATION supabase_realtime ADD TABLE public.user_teams;

-- 4. Enable realtime on match_player_points
ALTER PUBLICATION supabase_realtime ADD TABLE public.match_player_points;
