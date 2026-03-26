import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const ADMIN_EMAILS = ["admin@psl.com", "sameer@psl.com"];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Verify the caller is an admin
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // Use anon client to verify the user
    const anonClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });

    const token = authHeader.replace("Bearer ", "");
    const { data: claimsData, error: claimsError } = await anonClient.auth.getClaims(token);
    if (claimsError || !claimsData?.claims) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const userEmail = claimsData.claims.email as string;
    if (!ADMIN_EMAILS.includes(userEmail)) {
      return new Response(JSON.stringify({ error: "Forbidden: not an admin" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Use service role client for actual updates (bypasses RLS)
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const body = await req.json();
    const { match_id, team_a_score, team_b_score, status, cricbuzz_match_id, espn_match_id, player_points } = body;

    if (!match_id) {
      return new Response(JSON.stringify({ error: "match_id required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Update match scores
    const { error: matchError } = await supabase
      .from("matches")
      .update({
        team_a_score: team_a_score || null,
        team_b_score: team_b_score || null,
        status: status || "live",
        cricbuzz_match_id: cricbuzz_match_id || null,
        espn_match_id: espn_match_id || null,
      })
      .eq("id", match_id);

    if (matchError) throw matchError;

    // Upsert player points
    if (player_points && Array.isArray(player_points)) {
      for (const pp of player_points) {
        await supabase.from("match_player_points").upsert(
          {
            match_id,
            player_id: pp.player_id,
            points: pp.points,
            data_source: "manual",
          },
          { onConflict: "match_id,player_id" }
        );
      }

      // Update players.points as SUM across all matches
      const playerIds = player_points.map((pp: any) => pp.player_id);
      for (const playerId of playerIds) {
        const { data: allPoints } = await supabase
          .from("match_player_points")
          .select("points")
          .eq("player_id", playerId);
        const totalPoints = (allPoints || []).reduce((sum: number, row: any) => sum + (row.points || 0), 0);
        await supabase.from("players").update({ points: totalPoints }).eq("id", playerId);
      }
    }

    // Recalculate user team points for this match
    await recalcUserTeamPoints(supabase, match_id);

    return new Response(
      JSON.stringify({ success: true }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: unknown) {
    console.error("Admin update error:", error);
    const msg = error instanceof Error ? error.message : "Unknown error";
    return new Response(JSON.stringify({ success: false, error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

async function recalcUserTeamPoints(supabase: any, matchId: string) {
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
      if (tp.player_id === ut.captain_id) total += pts * 2;
      else if (tp.player_id === ut.vice_captain_id) total += pts * 1.5;
      else total += pts;
    }

    await supabase.from("user_teams").update({ total_points: Math.round(total) }).eq("id", ut.id);
  }

  // Update profile total points
  const userIds = [...new Set(userTeams.map((ut: any) => ut.user_id))];
  for (const userId of userIds) {
    const { data: allTeams } = await supabase
      .from("user_teams")
      .select("total_points")
      .eq("user_id", userId);
    const totalProfile = (allTeams || []).reduce((s: number, t: any) => s + (t.total_points || 0), 0);
    await supabase.from("profiles").update({ total_points: totalProfile }).eq("user_id", userId);
  }
}
