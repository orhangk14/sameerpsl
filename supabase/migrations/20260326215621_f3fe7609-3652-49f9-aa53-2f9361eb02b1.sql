
ALTER TABLE public.matches ADD COLUMN IF NOT EXISTS cricbuzz_match_id text;
ALTER TABLE public.matches ADD COLUMN IF NOT EXISTS espn_match_id text;
ALTER TABLE public.match_player_points ADD COLUMN IF NOT EXISTS data_source text DEFAULT 'cricapi';
