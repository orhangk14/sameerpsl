import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface PlayerStats {
  name: string;
  runs?: number;
  balls?: number;
  fours?: number;
  sixes?: number;
  out?: boolean;
  wickets?: number;
  oversBowled?: number;
  runsConceded?: number;
  maidens?: number;
  catches?: number;
  directRunOuts?: number;
  indirectRunOuts?: number;
  runOuts?: number;
  stumpings?: number;
}

interface TestScorecard {
  teamAScore: string | null;
  teamBScore: string | null;
  matchEnded: boolean;
  players: PlayerStats[];
  winningTeam: string | null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Get Test matches only
    const { data: testMatches } = await supabase
      .from("matches")
      .select("id, cricbuzz_match_id, team_a, team_b, status, format")
      .eq("format", "test")
      .in("status", ["live", "upcoming"]);

    if (!testMatches?.length) {
      return new Response(
        JSON.stringify({ success: true, message: "No Test matches", updated: 0 }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    let updated = 0;

    for (const match of testMatches) {
      if (!match.cricbuzz_match_id) continue;

      try {
        // Scrape Cricbuzz
        const scorecard = await scrapeCricbuzzTest(match.cricbuzz_match_id, match, supabase);
        if (!scorecard) continue;

        // Update match scores
        const status = scorecard.matchEnded ? "completed" : "live";
        const matchUpdate: any = { status };
        if (scorecard.teamAScore) matchUpdate.team_a_score = scorecard.teamAScore;
        if (scorecard.teamBScore) matchUpdate.team_b_score = scorecard.teamBScore;
        if (scorecard.winningTeam) matchUpdate.winning_team = scorecard.winningTeam;

        await supabase.from("matches").update(matchUpdate).eq("id", match.id);

        // Calculate player points (Test scoring)
        if (scorecard.players.length > 0) {
          await computeTestPlayerPoints(supabase, scorecard, match.id);
          await recalcUserTeamPoints(supabase, match.id);
        }

        updated++;
      } catch (err) {
        console.error(`Error updating Test match ${match.id}:`, err);
      }
    }

    return new Response(
      JSON.stringify({ success: true, updated }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: unknown) {
    console.error("Test sync error:", error);
    const msg = error instanceof Error ? error.message : "Unknown error";
    return new Response(JSON.stringify({ success: false, error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

// ─── Cricbuzz Test Scraper ─────────────────────────────────────────────────

async function scrapeCricbuzzTest(
  cricbuzzId: string,
  match: any,
  supabase: any
): Promise<TestScorecard | null> {
  try {
    const { data: html, error } = await supabase.rpc("http_get_text", {
      target_url: `https://www.cricbuzz.com/live-cricket-scorecard/${cricbuzzId}`
    });
    if (error || !html) return null;

    let teamAScore: string | null = null;
    let teamBScore: string | null = null;
    const players: PlayerStats[] = [];

    // Extract innings scores (Test has multiple innings per team)
    const inningsRegex = /\\?"inningsId\\?":\s*(\d+)\s*,\s*\\?"batTeamId\\?":\s*\d+\s*,\s*\\?"batTeamName\\?":\s*\\?"([^"\\]+)\\?"\s*,\s*\\?"score\\?":\s*(\d+)\s*,\s*\\?"wickets\\?":\s*(\d+)\s*,\s*\\?"overs\\?":\s*([\d.]+)/g;
    const inningsByTeam = new Map<string, string[]>();
    let im;
    while ((im = inningsRegex.exec(html)) !== null) {
      const teamName = im[2].toLowerCase();
      const score = `${im[3]}/${im[4]} (${im[5]})`;
      
      const teamKey = teamName.includes('pak') ? 'A' : 'B';
      if (!inningsByTeam.has(teamKey)) inningsByTeam.set(teamKey, []);
      inningsByTeam.get(teamKey)!.push(score);
    }

    // Format: "185/10 & 220/7"
    const teamAInnings = inningsByTeam.get('A') || [];
    const teamBInnings = inningsByTeam.get('B') || [];
    teamAScore = teamAInnings.join(' & ') || null;
    teamBScore = teamBInnings.join(' & ') || null;

    // Extract batsmen
    const batRegex = /\\?"batName\\?":\s*\\?"([^"\\]+)\\?"[^}]*?\\?"runs\\?":\s*(\d+)[^}]*?\\?"balls\\?":\s*(\d+)[^}]*?\\?"fours\\?":\s*(\d+)[^}]*?\\?"sixes\\?":\s*(\d+)/g;
    let bm;
    while ((bm = batRegex.exec(html)) !== null) {
      const name = bm[1];
      if (!name || name === "undefined") continue;
      mergePlayer(players, {
        name,
        runs: parseInt(bm[2]) || 0,
        balls: parseInt(bm[3]) || 0,
        fours: parseInt(bm[4]) || 0,
        sixes: parseInt(bm[5]) || 0,
      });
    }

    // Extract bowlers
    const bowlRegex = /\\?"bowlName\\?":\s*\\?"([^"\\]+)\\?"[^}]*?\\?"overs\\?":\s*([\d.]+)[^}]*?\\?"maidens\\?":\s*(\d+)[^}]*?\\?"runs\\?":\s*(\d+)[^}]*?\\?"wickets\\?":\s*(\d+)/g;
    let bwm;
    while ((bwm = bowlRegex.exec(html)) !== null) {
      const name = bwm[1];
      if (!name || name === "undefined") continue;
      mergePlayer(players, {
        name,
        oversBowled: parseFloat(bwm[2]) || 0,
        maidens: parseInt(bwm[3]) || 0,
        runsConceded: parseInt(bwm[4]) || 0,
        wickets: parseInt(bwm[5]) || 0,
      });
    }

    // Check match status
    const matchEnded = html.includes('"state":"Complete"') || html.includes('"matchEnded":true');

    // Extract winning team
    let winningTeam: string | null = null;
    if (matchEnded) {
      const statusRegex = /\\*"?status\\*"?\s*:\s*\\*"?([^"\\]{5,80})\\*"?/g;
      let sm;
      while ((sm = statusRegex.exec(html)) !== null) {
        const statusText = sm[1];
        if (statusText.toLowerCase().includes("won")) {
          winningTeam = extractWinningTeam(statusText, match.team_a, match.team_b);
          if (winningTeam) break;
        }
      }
    }

    return { teamAScore, teamBScore, matchEnded, players, winningTeam };
  } catch (err) {
    console.error("Cricbuzz Test scrape failed:", err);
    return null;
  }
}

function extractWinningTeam(statusText: string, teamA: string, teamB: string): string | null {
  const s = statusText.toLowerCase();
  if (s.includes(teamA.toLowerCase())) return teamA;
  if (s.includes(teamB.toLowerCase())) return teamB;
  return null;
}

function mergePlayer(players: PlayerStats[], incoming: PlayerStats) {
  const normalized = normalizeName(incoming.name);
  const existing = players.find(p => normalizeName(p.name) === normalized);
  if (existing) {
    if (incoming.runs !== undefined) existing.runs = (existing.runs || 0) + (incoming.runs || 0);
    if (incoming.balls !== undefined) existing.balls = (existing.balls || 0) + (incoming.balls || 0);
    if (incoming.fours !== undefined) existing.fours = (existing.fours || 0) + (incoming.fours || 0);
    if (incoming.sixes !== undefined) existing.sixes = (existing.sixes || 0) + (incoming.sixes || 0);
    if (incoming.wickets !== undefined) existing.wickets = (existing.wickets || 0) + (incoming.wickets || 0);
    if (incoming.oversBowled !== undefined) existing.oversBowled = (existing.oversBowled || 0) + (incoming.oversBowled || 0);
    if (incoming.runsConceded !== undefined) existing.runsConceded = (existing.runsConceded || 0) + (incoming.runsConceded || 0);
    if (incoming.maidens !== undefined) existing.maidens = (existing.maidens || 0) + (incoming.maidens || 0);
    if (incoming.catches !== undefined) existing.catches = (existing.catches || 0) + (incoming.catches || 0);
    if (incoming.directRunOuts !== undefined) existing.directRunOuts = (existing.directRunOuts || 0) + (incoming.directRunOuts || 0);
    if (incoming.indirectRunOuts !== undefined) existing.indirectRunOuts = (existing.indirectRunOuts || 0) + (incoming.indirectRunOuts || 0);
    if (incoming.runOuts !== undefined) existing.runOuts = (existing.runOuts || 0) + (incoming.runOuts || 0);
    if (incoming.stumpings !== undefined) existing.stumpings = (existing.stumpings || 0) + (incoming.stumpings || 0);
  } else {
    players.push({ ...incoming });
  }
}

function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z\s]/g, "")
    .trim();
}

// ─── Test Points Calculation ────────────────────────────────────────────────

interface TestPointsBreakdown {
  starting_xi: number;
  batting: number;
  bowling: number;
  fielding: number;
  total: number;
}

function calculateTestPoints(ps: PlayerStats): TestPointsBreakdown {
  const bd: TestPointsBreakdown = {
    starting_xi: 4,
    batting: ps.runs || 0,  // 1 point per run
    bowling: (ps.wickets || 0) * 25,  // 25 per wicket
    fielding: 0,
    total: 0,
  };

  bd.fielding += (ps.catches || 0) * 8;
  bd.fielding += (ps.directRunOuts || 0) * 12;
  bd.fielding += (ps.indirectRunOuts || 0) * 6;
  bd.fielding += (ps.runOuts || 0) * 12;
  bd.fielding += (ps.stumpings || 0) * 12;

  bd.total = bd.starting_xi + bd.batting + bd.bowling + bd.fielding;
  return bd;
}

async function computeTestPlayerPoints(
  supabase: ReturnType<typeof createClient>,
  scorecard: TestScorecard,
  matchId: string
) {
  const { data: dbPlayers } = await supabase
    .from("players")
    .select("id, name, team");

  if (!dbPlayers?.length) return;

  for (const ps of scorecard.players) {
    const normalizedPs = normalizeName(ps.name);
    const dbPlayer = dbPlayers.find(
      (dp: any) => normalizeName(dp.name) === normalizedPs ||
                   normalizeName(dp.name).includes(normalizedPs) ||
                   normalizedPs.includes(normalizeName(dp.name))
    );

    if (!dbPlayer) continue;

    const bd = calculateTestPoints(ps);

    await supabase.from("match_player_points").upsert(
      {
        match_id: matchId,
        player_id: dbPlayer.id,
        points: bd.total,
        data_source: "cricbuzz",
        breakdown: bd,
      },
      { onConflict: "match_id,player_id" }
    );

    // Update cumulative player points
    const { data: allMatchPoints } = await supabase
      .from("match_player_points")
      .select("points")
      .eq("player_id", dbPlayer.id);

    const totalGlobal = (allMatchPoints || []).reduce((sum: number, row: any) => sum + (row.points || 0), 0);
    await supabase.from("players").update({ points: totalGlobal, is_playing: true }).eq("id", dbPlayer.id);
  }
}

async function recalcUserTeamPoints(
  supabase: ReturnType<typeof createClient>,
  matchId: string
) {
  const { data: userTeams } = await supabase
    .from("user_teams")
    .select("id, captain_id, vice_captain_id, user_id")
    .eq("match_id", matchId);

  if (!userTeams?.length) return;

  for (const ut of userTeams) {
    const { data: teamPlayers } = await supabase
      .from("team_players")
      .select("player_id")
      .eq("user_team_id", ut.id);

    if (!teamPlayers?.length) continue;

    const playerIds = teamPlayers.map((tp: any) => tp.player_id);

    const { data: matchPoints } = await supabase
      .from("match_player_points")
      .select("player_id, points")
      .eq("match_id", matchId)
      .in("player_id", playerIds);

    const pointsMap = new Map((matchPoints || []).map((mp: any) => [mp.player_id, mp.points]));

    let total = 0;
    for (const tp of teamPlayers) {
      const pts = pointsMap.get(tp.player_id) || 0;
      if (tp.player_id === ut.captain_id) {
        total += pts * 2;
      } else if (tp.player_id === ut.vice_captain_id) {
        total += pts * 1.5;
      } else {
        total += pts;
      }
    }

    await supabase
      .from("user_teams")
      .update({ total_points: parseFloat(total.toFixed(1)) })
      .eq("id", ut.id);
  }

  // Recalc profile totals
  const userIds = [...new Set(userTeams.map((ut: any) => ut.user_id))];
  for (const userId of userIds) {
    const { data: allTeams } = await supabase
      .from("user_teams")
      .select("total_points")
      .eq("user_id", userId);

    const totalProfile = (allTeams || []).reduce((s: number, t: any) => s + (t.total_points || 0), 0);
    await supabase
      .from("profiles")
      .update({ total_points: totalProfile })
      .eq("user_id", userId);
  }
}