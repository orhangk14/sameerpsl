ALTER PUBLICATION supabase_realtime ADD TABLE public.players;

CREATE POLICY "Anyone can insert players" ON players FOR INSERT WITH CHECK (true);
CREATE POLICY "Anyone can update players" ON players FOR UPDATE USING (true);
CREATE POLICY "Anyone can delete players" ON players FOR DELETE USING (true);

CREATE POLICY "Anyone can insert match_players" ON match_players FOR INSERT WITH CHECK (true);
CREATE POLICY "Anyone can delete match_players" ON match_players FOR DELETE USING (true);
