import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const CRICAPI_BASE = "https://api.cricapi.com/v1";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const CRICAPI_KEY = Deno.env.get("CRICAPI_KEY");
    if (!CRICAPI_KEY) throw new Error("CRICAPI_KEY is not configured");

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Step 1: Fetch current/recent matches from CricAPI
    const matchesRes = await fetch(
      `${CRICAPI_BASE}/currentMatches?apikey=${CRICAPI_KEY}&offset=0`
    );
    if (!matchesRes.ok) {
      throw new Error(`CricAPI currentMatches failed [${matchesRes.status}]: ${await matchesRes.text()}`);
    }
    const matchesData = await matchesRes.json();

    if (matchesData.status !== "success") {
      throw new Error(`CricAPI error: ${matchesData.info || "Unknown error"}`);
    }

    // Filter PSL matches
    const pslMatches = (matchesData.data || []).filter(
      (m: any) =>
        m.series_id &&
        (m.name?.toLowerCase().includes("psl") ||
          m.name?.toLowerCase().includes("pakistan super league") ||
          m.series_id?.toLowerCase().includes("psl"))
    );

    // Also fetch series list to find PSL series ID
    const seriesRes = await fetch(
      `${CRICAPI_BASE}/series?apikey=${CRICAPI_KEY}&offset=0`
    );
    let pslSeriesId: string | null = null;
    if (seriesRes.ok) {
      const seriesData = await seriesRes.json();
      if (seriesData.status === "success") {
        const pslSeries = (seriesData.data || []).find(
          (s: any) =>
            s.info?.toLowerCase().includes("psl") ||
            s.info?.toLowerCase().includes("pakistan super league")
        );
        if (pslSeries) pslSeriesId = pslSeries.id;
      }
    }

    // If we found a PSL series, fetch its matches too
    let seriesMatches: any[] = [];
    if (pslSeriesId) {
      const seriesInfoRes = await fetch(
        `${CRICAPI_BASE}/series_info?apikey=${CRICAPI_KEY}&id=${pslSeriesId}`
      );
      if (seriesInfoRes.ok) {
        const seriesInfoData = await seriesInfoRes.json();
        if (seriesInfoData.status === "success") {
          seriesMatches = seriesInfoData.data?.matchList || [];
        }
      }
    }

    // Combine and deduplicate
    const allMatches = [...pslMatches];
    for (const sm of seriesMatches) {
      if (sm.id && !allMatches.find((m: any) => m.id === sm.id)) {
        allMatches.push(sm);
      }
    }

    const upsertedMatches: any[] = [];

    for (const m of allMatches) {
      const teams = (m.teams || []) as string[];
      const teamA = teams[0] || m.teamInfo?.[0]?.name || "TBD";
      const teamB = teams[1] || m.teamInfo?.[1]?.name || "TBD";
      const teamALogo =
        m.teamInfo?.[0]?.shortname ||
        teamA
          .split(" ")
          .map((w: string) => w[0])
          .join("")
          .slice(0, 3)
          .toUpperCase();
      const teamBLogo =
        m.teamInfo?.[1]?.shortname ||
        teamB
          .split(" ")
          .map((w: string) => w[0])
          .join("")
          .slice(0, 3)
          .toUpperCase();

      let status = "upcoming";
      if (m.matchStarted && !m.matchEnded) status = "live";
      else if (m.matchEnded) status = "completed";
      else if (m.status?.toLowerCase().includes("won") || m.status?.toLowerCase().includes("drawn"))
        status = "completed";

      const scores = m.score || [];
      let teamAScore: string | null = null;
      let teamBScore: string | null = null;
      for (const s of scores) {
        const innings = `${s.r || 0}/${s.w || 0} (${s.o || 0})`;
        if (s.inning?.includes(teamA) || s.inning?.includes(teamALogo)) {
          teamAScore = teamAScore ? `${teamAScore} & ${innings}` : innings;
        } else {
          teamBScore = teamBScore ? `${teamBScore} & ${innings}` : innings;
        }
      }

      const matchDate = m.dateTimeGMT || m.date || new Date().toISOString();

      const { data, error } = await supabase
        .from("matches")
        .upsert(
          {
            id: m.id,
            team_a: teamA,
            team_b: teamB,
            team_a_logo: teamALogo,
            team_b_logo: teamBLogo,
            match_date: matchDate,
            venue: m.venue || "TBD",
            status,
            team_a_score: teamAScore,
            team_b_score: teamBScore,
          },
          { onConflict: "id" }
        )
        .select()
        .single();

      if (!error && data) upsertedMatches.push(data);

      // Fetch squad for this match
      if (m.id) {
        try {
          const squadRes = await fetch(
            `${CRICAPI_BASE}/match_squad?apikey=${CRICAPI_KEY}&id=${m.id}`
          );
          if (squadRes.ok) {
            const squadData = await squadRes.json();
            if (squadData.status === "success" && squadData.data) {
              for (const teamSquad of squadData.data) {
                const teamName = teamSquad.teamName || "Unknown";
                for (const p of teamSquad.players || []) {
                  const role = mapRole(p.battingStyle, p.bowlingStyle, p.role);
                  const { data: player } = await supabase
                    .from("players")
                    .upsert(
                      {
                        id: p.id,
                        name: p.name || "Unknown",
                        team: teamName,
                        role,
                        credits: estimateCredits(p),
                        image_url: p.playerImg || null,
                        is_playing: p.playingXI === true ? true : p.playingXI === false ? false : null,
                      },
                      { onConflict: "id" }
                    )
                    .select()
                    .single();

                  // Link player to match
                  if (player) {
                    await supabase
                      .from("match_players")
                      .upsert(
                        { match_id: m.id, player_id: player.id },
                        { onConflict: "match_id,player_id" }
                      );
                  }
                }
              }
            }
          }
        } catch (squadErr) {
          console.error(`Squad fetch error for match ${m.id}:`, squadErr);
        }
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        matches_synced: upsertedMatches.length,
        psl_series_id: pslSeriesId,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: unknown) {
    console.error("Sync error:", error);
    const msg = error instanceof Error ? error.message : "Unknown error";
    return new Response(JSON.stringify({ success: false, error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

function mapRole(battingStyle?: string, bowlingStyle?: string, role?: string): "BAT" | "BOWL" | "AR" | "WK" {
  const r = (role || "").toLowerCase();
  if (r.includes("keeper") || r.includes("wk")) return "WK";
  if (r.includes("all") || r.includes("ar")) return "AR";
  if (r.includes("bowl")) return "BOWL";
  if (r.includes("bat")) return "BAT";
  // Fallback: if both batting and bowling style exist, likely all-rounder
  if (battingStyle && bowlingStyle && !bowlingStyle.toLowerCase().includes("none")) return "AR";
  if (bowlingStyle && !bowlingStyle.toLowerCase().includes("none")) return "BOWL";
  return "BAT";
}

function estimateCredits(player: any): number {
  // Simple credit estimation based on role and name recognition
  // In production, this would use actual performance data
  const r = (player.role || "").toLowerCase();
  if (r.includes("captain")) return 10;
  if (r.includes("keeper")) return 8.5;
  if (r.includes("all")) return 8;
  return 7.5;
}
