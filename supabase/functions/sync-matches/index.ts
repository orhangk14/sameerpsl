import { createClient } from "npm:@supabase/supabase-js@2";

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

    // Fetch ALL matches (not just current) across multiple offsets to find PSL matches
    const allPslMatches: any[] = [];

    for (let offset = 0; offset <= 75; offset += 25) {
      const data = await fetchViaDb<any>(
        supabase,
        `${CRICAPI_BASE}/matches?apikey=${encodeURIComponent(CRICAPI_KEY)}&offset=${offset}`
      );

      if (data.status !== "success" || !data.data) break;

      const psl = data.data.filter(
        (m: any) =>
          m?.name?.toLowerCase().includes("pakistan super league") ||
          m?.name?.toLowerCase().includes("psl 2026")
      );
      allPslMatches.push(...psl);

      // If fewer than 25 results, no more pages
      if (data.data.length < 25) break;
    }

    // Also fetch currentMatches for live score data
    let currentMatchData: any[] = [];
    try {
      const currentData = await fetchViaDb<any>(
        supabase,
        `${CRICAPI_BASE}/currentMatches?apikey=${encodeURIComponent(CRICAPI_KEY)}&offset=0`
      );
      if (currentData.status === "success" && currentData.data) {
        currentMatchData = currentData.data.filter(
          (m: any) =>
            m?.name?.toLowerCase().includes("pakistan super league") ||
            m?.name?.toLowerCase().includes("psl 2026")
        );
      }
    } catch (e) {
      console.error("currentMatches fetch failed:", e);
    }

    // Merge: prefer currentMatches data (has live scores) over matches data
    const currentMatchMap = new Map<string, any>();
    for (const m of currentMatchData) {
      if (m?.id) currentMatchMap.set(m.id, m);
    }

    const mergedMatches: any[] = [];
    const seenIds = new Set<string>();

    // Add currentMatches first (they have live scores)
    for (const m of currentMatchData) {
      if (m?.id && !seenIds.has(m.id)) {
        seenIds.add(m.id);
        mergedMatches.push(m);
      }
    }

    // Add remaining from matches endpoint
    for (const m of allPslMatches) {
      if (m?.id && !seenIds.has(m.id)) {
        seenIds.add(m.id);
        mergedMatches.push(m);
      }
    }

    let matchesSynced = 0;

    for (const match of mergedMatches) {
      const externalId = match?.id;
      if (!externalId) continue;

      // Parse teams from match name if teamInfo not available
      const teams = (match.teams || []) as string[];
      const teamA = teams[0] || match.teamInfo?.[0]?.name || parseTeamFromName(match.name, 0);
      const teamB = teams[1] || match.teamInfo?.[1]?.name || parseTeamFromName(match.name, 1);
      const teamALogo =
        match.teamInfo?.[0]?.shortname ||
        getTeamAbbr(teamA);
      const teamBLogo =
        match.teamInfo?.[1]?.shortname ||
        getTeamAbbr(teamB);

      let status = "upcoming";
      if (match.matchStarted && !match.matchEnded) status = "live";
      else if (match.matchEnded) status = "completed";
      else if (match.status?.toLowerCase().includes("won") || match.status?.toLowerCase().includes("drawn") || match.status?.toLowerCase().includes("tied")) status = "completed";

      const scores = match.score || [];
      let teamAScore: string | null = null;
      let teamBScore: string | null = null;

      for (const score of scores) {
        const innings = `${score.r || 0}/${score.w || 0} (${score.o || 0})`;
        if (score.inning?.includes(teamA) || score.inning?.includes(teamALogo)) {
          teamAScore = teamAScore ? `${teamAScore} & ${innings}` : innings;
        } else {
          teamBScore = teamBScore ? `${teamBScore} & ${innings}` : innings;
        }
      }

      const matchDate = match.dateTimeGMT || match.date || new Date().toISOString();

      // Extract match number from name for display
      const venue = match.venue || "TBD";

      const { data: existing } = await supabase.from("matches").select("id").eq("external_id", externalId).maybeSingle();

      if (existing) {
        await supabase
          .from("matches")
          .update({
            team_a: teamA, team_b: teamB,
            team_a_logo: teamALogo, team_b_logo: teamBLogo,
            match_date: matchDate, venue, status,
            team_a_score: teamAScore, team_b_score: teamBScore,
          })
          .eq("id", existing.id);
      } else {
        const { error } = await supabase
          .from("matches")
          .insert({
            external_id: externalId,
            team_a: teamA, team_b: teamB,
            team_a_logo: teamALogo, team_b_logo: teamBLogo,
            match_date: matchDate, venue, status,
            team_a_score: teamAScore, team_b_score: teamBScore,
          });
        if (error) {
          console.error(`Insert match error: ${error.message}`);
          continue;
        }
      }

      matchesSynced++;
    }

    return new Response(JSON.stringify({ success: true, matches_synced: matchesSynced }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: unknown) {
    console.error("Sync error:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return new Response(JSON.stringify({ success: false, error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

async function fetchViaDb<T>(supabase: ReturnType<typeof createClient>, url: string): Promise<T> {
  const { data, error } = await supabase.rpc("http_get_json", { target_url: url });
  if (error) throw new Error(`Database HTTP fetch failed: ${error.message}`);
  return data as T;
}

function parseTeamFromName(name: string, index: number): string {
  if (!name) return "TBD";
  const parts = name.split(" vs ");
  if (parts.length >= 2) {
    const team = parts[index]?.split(",")[0]?.trim();
    return team || "TBD";
  }
  return "TBD";
}

function getTeamAbbr(teamName: string): string {
  const abbrs: Record<string, string> = {
    "Lahore Qalandars": "LQ",
    "Karachi Kings": "KK",
    "Islamabad United": "IU",
    "Peshawar Zalmi": "PZ",
    "Quetta Gladiators": "QG",
    "Multan Sultans": "MS",
    "Hyderabad Kingsmen": "HK",
    "Rawalpindi Pindiz": "RP",
  };
  return abbrs[teamName] || teamName.split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase();
}
