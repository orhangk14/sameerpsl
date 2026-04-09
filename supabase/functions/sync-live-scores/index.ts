import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
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
  stumpings?: number;
}

interface NormalizedScorecard {
  teamAScore: string | null;
  teamBScore: string | null;
  matchEnded: boolean;
  players: PlayerStats[];
  winningTeam: string | null;
  playerOfTheMatch: string | null;
}

interface PointsBreakdown {
  starting_xi: number;
  batting: number;
  bowling: number;
  fielding: number;
  sr_bonus: number;
  er_bonus: number;
  milestone: number;
  total: number;
}

interface PlayerIndex {
  byNormalized: Map<string, any>;
  byAlias: Map<string, any>;
}

const PSL_TEAM_KEYWORDS: Record<string, string[]> = {
  "Quetta": ["quetta", "gladiators", "qtg", "que", "glad"],
  "Karachi": ["karachi", "kings", "krk", "kar"],
  "Lahore": ["lahore", "qalandars", "lhq", "lah", "qal"],
  "Islamabad": ["islamabad", "united", "isu", "isl"],
  "Peshawar": ["peshawar", "zalmi", "psz", "pes", "zal"],
  "Multan": ["multan", "sultans", "ms", "mul", "sul"],
  "Rawalpindi": ["rawalpindi", "raiders", "pindiz", "rwp", "raw", "pin"],
  "Hyderabad": ["hyderabad", "kingsmen", "hydk", "hyd", "king"],
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const body = await req.json().catch(() => ({}));
    const dryRun = body.dry_run === true;
    if (dryRun) console.log("[DRY RUN] No database writes will occur");

    const now = new Date();
    const sixHoursAgo = new Date(now.getTime() - 6 * 60 * 60 * 1000).toISOString();

    const [
      { data: pendingMatches },
      { data: liveMatches },
      { data: recentCompleted },
    ] = await Promise.all([
      supabase
        .from("matches")
        .select("id, cricbuzz_match_id, team_a, team_b")
        .eq("status", "upcoming")
        .lte("match_date", now.toISOString()),
      supabase
        .from("matches")
        .select("id, cricbuzz_match_id, team_a, team_b, status")
        .eq("status", "live"),
      supabase
        .from("matches")
        .select("id, cricbuzz_match_id, team_a, team_b")
        .eq("status", "completed")
        .gte("match_date", sixHoursAgo),
    ]);

    if (pendingMatches?.length) {
      const transitionChecks = pendingMatches
        .filter(pm => pm.cricbuzz_match_id)
        .map(async (pm) => {
          const { data: html } = await supabase.rpc("http_get_text", {
            target_url: "https://www.cricbuzz.com/live-cricket-scores/" + pm.cricbuzz_match_id
          });
          if (html && isScopedState(html, pm.team_a, pm.team_b, "In Progress")) {
            if (!dryRun) {
              await supabase.from("matches").update({ status: "live" }).eq("id", pm.id);
            }
            console.log((dryRun ? "[DRY RUN] Would transition " : "Transitioned ") + pm.team_a + " vs " + pm.team_b + " to live");
            liveMatches?.push({ ...pm, status: "live" });
          }
        });
      await Promise.all(transitionChecks);
    }

    if (recentCompleted?.length) {
      await handleMotmRecheck(supabase, recentCompleted, dryRun);
    }

    if (recentCompleted?.length) {
      const integrityChecks = recentCompleted
        .filter(rm => rm.cricbuzz_match_id)
        .map(async (rm) => {
          const { data: html } = await supabase.rpc("http_get_text", {
            target_url: "https://www.cricbuzz.com/live-cricket-scores/" + rm.cricbuzz_match_id
          });
          if (html && isScopedState(html, rm.team_a, rm.team_b, "In Progress")) {
            console.warn("INTEGRITY: Match " + rm.id + " (" + rm.team_a + " vs " + rm.team_b + ") marked completed but Cricbuzz says In Progress — reverting to live");
            if (!dryRun) {
              await supabase
                .from("matches")
                .update({ status: "live", winning_team: null })
                .eq("id", rm.id);
            }
            liveMatches?.push({ ...rm, status: "live" });
          }
        });
      await Promise.all(integrityChecks);
    }

    if (!liveMatches?.length) {
      return jsonResponse({ success: true, message: "No live matches to update", updated: 0 });
    }

    const [aliasMap, { data: dbPlayers }] = await Promise.all([
      loadAliasMap(supabase),
      supabase.from("players").select("id, name, team, external_id"),
    ]);

    if (!dbPlayers?.length) {
      return jsonResponse({ success: true, message: "No players in database", updated: 0 });
    }

    const playerIndex = buildPlayerIndex(dbPlayers, aliasMap);
    let updated = 0;

    for (const match of liveMatches) {
      try {
        if (!match.cricbuzz_match_id) {
          console.log("Match " + match.id + " has no cricbuzz_match_id — skipping");
          continue;
        }

        const scorecard = await fetchCricbuzzFull(match.cricbuzz_match_id, match, supabase);
        if (!scorecard) {
          console.log("No scorecard data for match " + match.id);
          continue;
        }

        const scoreUpdate: Record<string, string> = {};
        if (scorecard.teamAScore) scoreUpdate.team_a_score = scorecard.teamAScore;
        if (scorecard.teamBScore) scoreUpdate.team_b_score = scorecard.teamBScore;

        if (Object.keys(scoreUpdate).length > 0) {
          if (!dryRun) {
            await supabase.from("matches").update(scoreUpdate).eq("id", match.id);
          }
          console.log((dryRun ? "[DRY RUN] " : "") + "Scores: " + scorecard.teamAScore + " / " + scorecard.teamBScore);
        }

        if (scorecard.players.length > 0) {
          await computePlayerPoints(supabase, scorecard, match.id, playerIndex, dbPlayers, dryRun);
          await recalcUserTeamPoints(supabase, match.id, dryRun);
        }

        if (scorecard.matchEnded) {
          const { data: currentMatch } = await supabase
            .from("matches")
            .select("team_a_score, team_b_score")
            .eq("id", match.id)
            .single();

          const storedA = currentMatch?.team_a_score || "";
          const storedB = currentMatch?.team_b_score || "";
          const newA = scorecard.teamAScore || "";
          const newB = scorecard.teamBScore || "";
          const scoresStable = storedA === newA && storedB === newB && storedA !== "";

          if (!scoresStable) {
            console.log("Match " + match.id + " completion detected but scores not yet stable (" + storedA + " -> " + newA + ", " + storedB + " -> " + newB + ") — keeping live for one more tick");
          } else {
            console.log("Match " + match.id + " confirmed complete with stable scores — finalizing");

            if (!dryRun) {
              await supabase
                .from("players")
                .update({ is_playing: null })
                .eq("is_playing", true)
                .in("team", [match.team_a, match.team_b]);

              const completionUpdate: Record<string, any> = { status: "completed" };
              if (scorecard.winningTeam) completionUpdate.winning_team = scorecard.winningTeam;
              if (scorecard.teamAScore) completionUpdate.team_a_score = scorecard.teamAScore;
              if (scorecard.teamBScore) completionUpdate.team_b_score = scorecard.teamBScore;
              await supabase.from("matches").update(completionUpdate).eq("id", match.id);
            }
            console.log((dryRun ? "[DRY RUN] Would mark" : "Marked") + " match " + match.id + " completed");
          }
        }

        updated++;
      } catch (matchErr) {
        console.error("Error updating match " + match.id + ":", matchErr);
      }
    }

    return jsonResponse({ success: true, updated, dryRun });
  } catch (error: unknown) {
    console.error("Live sync error:", error);
    const msg = error instanceof Error ? error.message : "Unknown error";
    return new Response(JSON.stringify({ success: false, error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

function jsonResponse(body: Record<string, any>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function findMotmName(html: string): string | null {
  const marker = "playersOfTheMatch";
  const pos = html.indexOf(marker);
  if (pos === -1) return null;

  const chunk = html.substring(pos, Math.min(html.length, pos + 500));
  const namePos = chunk.indexOf("name");
  if (namePos === -1) return null;

  const colonPos = chunk.indexOf(":", namePos + 4);
  if (colonPos === -1) return null;

  let start = colonPos + 1;
  while (start < chunk.length) {
    const ch = chunk.charAt(start);
    if (ch !== " " && ch !== '"' && ch !== "\\" && ch !== "\n" && ch !== "\t") break;
    start++;
  }

  let end = start;
  while (end < chunk.length) {
    const ch = chunk.charAt(end);
    if (ch === '"' || ch === "\\" || ch === "," || ch === "}") break;
    end++;
  }

  const name = chunk.substring(start, end).trim();
  return name.length > 2 ? name : null;
}

function isScopedState(html: string, teamA: string, teamB: string, state: string): boolean {
  const slugA = teamA.split(" ")[0].toLowerCase();
  const slugB = teamB.split(" ")[0].toLowerCase();
  const safeState = state.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regex = new RegExp(safeState, "g");
  let m;
  while ((m = regex.exec(html)) !== null) {
    const start = Math.max(0, m.index - 500);
    const end = Math.min(html.length, m.index + 500);
    const context = html.substring(start, end).toLowerCase();
    if (context.includes(slugA) && context.includes(slugB)) return true;
  }
  return false;
}

function buildPlayerIndex(dbPlayers: any[], aliasMap: Map<string, string>): PlayerIndex {
  const byNormalized = new Map<string, any>();
  for (const p of dbPlayers) {
    byNormalized.set(normalizeName(p.name), p);
  }
  const byAlias = new Map<string, any>();
  for (const [alias, playerId] of aliasMap) {
    const player = dbPlayers.find(p => p.id === playerId);
    if (player) byAlias.set(alias, player);
  }
  return { byNormalized, byAlias };
}

function findPlayer(index: PlayerIndex, name: string): any | null {
  const norm = normalizeName(name);
  const exact = index.byNormalized.get(norm);
  if (exact) return exact;
  for (const [key, p] of index.byNormalized) {
    if (key.includes(norm) || norm.includes(key)) return p;
  }
  const aliased = index.byAlias.get(norm);
  if (aliased) return aliased;
  return null;
}

async function loadAliasMap(supabase: ReturnType<typeof createClient>): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const { data } = await supabase.from("player_aliases").select("player_id, alias");
  if (data) {
    for (const row of data) {
      map.set(normalizeName(row.alias), row.player_id);
    }
  }
  return map;
}

async function handleMotmRecheck(
  supabase: ReturnType<typeof createClient>,
  recentCompleted: any[],
  dryRun: boolean
) {
  for (const rm of recentCompleted) {
    if (!rm.cricbuzz_match_id) continue;

    const { data: motmCheck } = await supabase
      .from("match_player_points")
      .select("id")
      .eq("match_id", rm.id)
      .gt("breakdown->motm_bonus", 0)
      .limit(1);

    if (motmCheck?.length) continue;

    const { data: html } = await supabase.rpc("http_get_text", {
      target_url: "https://www.cricbuzz.com/live-cricket-scores/" + rm.cricbuzz_match_id
    });

    if (!html) continue;

    const motmName = findMotmName(html);
    if (!motmName) continue;

    console.log("MOTM re-check: " + motmName + " for " + rm.team_a + " vs " + rm.team_b);

    const { data: matchPoints } = await supabase
      .from("match_player_points")
      .select("id, player_id, breakdown, points, players!inner(name)")
      .eq("match_id", rm.id);

    if (!matchPoints?.length) continue;

    const motmNorm = normalizeName(motmName);
    const target = matchPoints.find((mp: any) => {
      const pNorm = normalizeName(mp.players.name);
      return pNorm === motmNorm || pNorm.includes(motmNorm) || motmNorm.includes(pNorm);
    });

    if (!target || target.breakdown?.motm_bonus > 0) continue;

    const newTotal = (target.breakdown?.total || 0) + 30;
    const newBreakdown = { ...target.breakdown, motm_bonus: 30, total: newTotal };

    if (!dryRun) {
      await supabase
        .from("match_player_points")
        .update({ breakdown: newBreakdown, points: target.points + 30 })
        .eq("id", target.id);
      await recalcUserTeamPoints(supabase, rm.id, false);
    }
    console.log((dryRun ? "[DRY RUN] Would apply" : "Applied") + " MOTM +30 to " + motmName);
  }
}

async function fetchCricbuzzFull(
  cricbuzzId: string,
  match: any,
  supabase: any
): Promise<NormalizedScorecard | null> {
  try {
    const [scoresResult, scorecardResult] = await Promise.all([
      supabase.rpc("http_get_text", {
        target_url: "https://www.cricbuzz.com/live-cricket-scores/" + cricbuzzId
      }),
      supabase.rpc("http_get_text", {
        target_url: "https://www.cricbuzz.com/live-cricket-scorecard/" + cricbuzzId
      }),
    ]);

    const html = scoresResult.data;
    const scHtml = scorecardResult.data;

    if (!html) {
      console.log("Cricbuzz: no data for " + cricbuzzId);
      return null;
    }

    console.log("Cricbuzz: scores page " + html.length + " chars, scorecard page " + (scHtml?.length || 0) + " chars");

    const matchEnded = isScopedState(html, match.team_a, match.team_b, "Complete");

    let teamAScore: string | null = null;
    let teamBScore: string | null = null;

    const inningsRegex = /\\?"inningsId\\?":\s*(\d+)\s*,\s*\\?"batTeamId\\?":\s*\d+\s*,\s*\\?"batTeamName\\?":\s*\\?"([^"\\]+)\\?"\s*,\s*\\?"score\\?":\s*(\d+)\s*,\s*\\?"wickets\\?":\s*(\d+)\s*,\s*\\?"overs\\?":\s*([\d.]+)/g;
    const inningsByid = new Map<string, { team: string; score: string }>();
    let im;
    while ((im = inningsRegex.exec(html)) !== null) {
      inningsByid.set(im[1], { team: im[2], score: im[3] + "/" + im[4] + " (" + im[5] + ")" });
    }

    for (const inn of inningsByid.values()) {
      if (teamMatchesKeywords(match.team_a, inn.team)) {
        teamAScore = teamAScore ? teamAScore + " & " + inn.score : inn.score;
      } else if (teamMatchesKeywords(match.team_b, inn.team)) {
        teamBScore = teamBScore ? teamBScore + " & " + inn.score : inn.score;
      } else {
        console.log("Cricbuzz: innings team " + inn.team + " didn't match either team — skipping");
      }
    }

    if (!teamAScore && !teamBScore) {
      const titleRegex = /(\w+)\s+(\d+)\/(\d+)\s*\(([\d.]+)\)/g;
      let tm;
      while ((tm = titleRegex.exec(html)) !== null) {
        const score = tm[2] + "/" + tm[3] + " (" + tm[4] + ")";
        if (!teamAScore) teamAScore = score;
        else if (!teamBScore && score !== teamAScore) { teamBScore = score; break; }
      }
    }

    if (!teamAScore && !teamBScore) {
      console.log("Cricbuzz: no scores found for " + cricbuzzId);
      return null;
    }

    const players: PlayerStats[] = [];
    if (scHtml && scHtml.length > 1000) {
      const scorecardPlayers = parseScorecardPlayers(scHtml);
      for (const sp of scorecardPlayers) mergePlayer(players, sp);
      console.log("Cricbuzz: " + scorecardPlayers.length + " players from scorecard");
    } else {
      parseMiniscorePlayers(html, players);
      console.log("Cricbuzz: " + players.length + " players from miniscore fallback");
    }

    let winningTeam: string | null = null;
    if (matchEnded) {
      const statusRegex = /\\*"?status\\*"?\s*:\s*\\*"?([^"\\]{5,80})\\*"?/g;
      let sm;
      while ((sm = statusRegex.exec(html)) !== null) {
        const result = extractWinningTeam(sm[1], match.team_a, match.team_b);
        if (result) { winningTeam = result; break; }
      }
    }

    const playerOfTheMatch = findMotmName(html);
    if (playerOfTheMatch) {
      console.log("Cricbuzz: MOTM = " + playerOfTheMatch);
    }

    console.log("Cricbuzz: " + teamAScore + " / " + teamBScore + ", " + players.length + " players, ended=" + matchEnded + ", winner=" + winningTeam);
    return { teamAScore, teamBScore, matchEnded, players, winningTeam, playerOfTheMatch };
  } catch (err) {
    console.log("Cricbuzz failed for " + match.id + ":", err);
    return null;
  }
}

function parseScorecardPlayers(html: string): PlayerStats[] {
  const players: PlayerStats[] = [];

  const batRegex = /\\?"batName\\?":\s*\\?"([^"\\]+)\\?"[^}]*?\\?"runs\\?":\s*(\d+)[^}]*?\\?"balls\\?":\s*(\d+)[^}]*?\\?"fours\\?":\s*(\d+)[^}]*?\\?"sixes\\?":\s*(\d+)/g;
  let bm;
  while ((bm = batRegex.exec(html)) !== null) {
    const name = bm[1];
    if (!name || name === "undefined") continue;

    const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const outDescRegex = new RegExp(
      '\\\\?"batName\\\\?":\\s*\\\\?"' + escapedName + '\\\\?"[^}]*?\\\\?"outDesc\\\\?":\\s*\\\\?"([^"\\\\]*?)\\\\?"',
      "g"
    );
    const outMatch = outDescRegex.exec(html);
    const outDesc = outMatch ? outMatch[1] : "";
    const isOut = outDesc ? !outDesc.includes("not out") && outDesc !== "" && outDesc !== "batting" : false;

    mergePlayer(players, {
      name,
      runs: parseInt(bm[2]) || 0,
      balls: parseInt(bm[3]) || 0,
      fours: parseInt(bm[4]) || 0,
      sixes: parseInt(bm[5]) || 0,
      out: isOut || undefined,
    });

    if (outDesc && !outDesc.includes("not out") && outDesc !== "" && outDesc !== "batting") {
      extractFieldingFromOutDesc(players, outDesc);
    }
  }

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

  return players;
}

function parseMiniscorePlayers(html: string, players: PlayerStats[]) {
  const batRegex = /\\?"(?:batsmanStriker|batsmanNonStriker)\\?":\s*\{[^}]*?\\?"name\\?":\s*\\?"([^"\\]+)\\?"[^}]*?\\?"runs\\?":\s*(\d+)[^}]*?\\?"balls\\?":\s*(\d+)[^}]*?\\?"fours\\?":\s*(\d+)[^}]*?\\?"sixes\\?":\s*(\d+)/g;
  let bm;
  while ((bm = batRegex.exec(html)) !== null) {
    if (bm[1] && bm[1] !== "undefined") {
      mergePlayer(players, {
        name: bm[1],
        runs: parseInt(bm[2]) || 0,
        balls: parseInt(bm[3]) || 0,
        fours: parseInt(bm[4]) || 0,
        sixes: parseInt(bm[5]) || 0,
      });
    }
  }

  const bowlRegex = /\\?"(?:bowlerStriker|bowlerNonStriker)\\?":\s*\{[^}]*?\\?"name\\?":\s*\\?"([^"\\]+)\\?"[^}]*?\\?"overs\\?":\s*([\d.]+)[^}]*?\\?"maidens\\?":\s*(\d+)[^}]*?\\?"runs\\?":\s*(\d+)[^}]*?\\?"wickets\\?":\s*(\d+)/g;
  let bwm;
  while ((bwm = bowlRegex.exec(html)) !== null) {
    if (bwm[1] && bwm[1] !== "undefined") {
      mergePlayer(players, {
        name: bwm[1],
        oversBowled: parseFloat(bwm[2]) || 0,
        maidens: parseInt(bwm[3]) || 0,
        runsConceded: parseInt(bwm[4]) || 0,
        wickets: parseInt(bwm[5]) || 0,
      });
    }
  }

  const lastWicketRegex = /\\?"lastWicket\\?":\s*\\?"([^"\\]+)\s+(\d+)\((\d+)\)/g;
  let lwm;
  while ((lwm = lastWicketRegex.exec(html)) !== null) {
    const name = lwm[1].trim().replace(/\s+[cb]\s+.*/, "").trim();
    if (name && name.length > 2) {
      mergePlayer(players, { name, runs: parseInt(lwm[2]) || 0, balls: parseInt(lwm[3]) || 0, out: true });
    }
  }
}

function extractFieldingFromOutDesc(players: PlayerStats[], outDesc: string) {
  const cleaned = outDesc.replace(/\u2020/g, "").trim();

  const cAndBMatch = cleaned.match(/^c\s*&\s*b\s+(.+)/);
  if (cAndBMatch) {
    const bowler = cAndBMatch[1].trim();
    if (bowler.length > 1) mergePlayer(players, { name: bowler, catches: 1 });
    return;
  }

  const catchMatch = cleaned.match(/^c\s+(.+?)\s+b\s+/);
  if (catchMatch) {
    const fielder = catchMatch[1].trim();
    if (fielder !== "&" && fielder.length > 1) mergePlayer(players, { name: fielder, catches: 1 });
  }

  const stumpMatch = cleaned.match(/^st\s+(.+?)\s+b\s+/);
  if (stumpMatch) {
    const keeper = stumpMatch[1].trim();
    if (keeper.length > 1) mergePlayer(players, { name: keeper, stumpings: 1 });
  }

  const runOutMatch = cleaned.match(/run out\s*\(([^)]+)\)/);
  if (runOutMatch) {
    const fielders = runOutMatch[1].trim().split("/").map(f => f.trim()).filter(f => f.length > 1);
    if (fielders.length === 1) {
      mergePlayer(players, { name: fielders[0], directRunOuts: 1 });
    } else if (fielders.length >= 2) {
      const lastIdx = fielders.length - 1;
      mergePlayer(players, { name: fielders[lastIdx], directRunOuts: 1 });
      for (let i = 0; i < lastIdx; i++) {
        mergePlayer(players, { name: fielders[i], indirectRunOuts: 1 });
      }
    }
  }
}

function extractWinningTeam(statusText: string | undefined | null, teamA: string, teamB: string): string | null {
  if (!statusText) return null;
  const s = statusText.toLowerCase();
  if (!s.includes("won") && !s.includes("beat")) return null;

  const winIdx = Math.max(s.indexOf("won"), s.indexOf("beat"));
  const tA = teamA.toLowerCase();
  const tB = teamB.toLowerCase();

  if (s.includes(tA) && s.indexOf(tA) < winIdx) return teamA;
  if (s.includes(tB) && s.indexOf(tB) < winIdx) return teamB;

  for (const word of tA.split(/\s+/)) {
    if (word.length >= 4 && s.includes(word) && s.indexOf(word) < winIdx) return teamA;
  }
  for (const word of tB.split(/\s+/)) {
    if (word.length >= 4 && s.includes(word) && s.indexOf(word) < winIdx) return teamB;
  }

  for (const [key, keywords] of Object.entries(PSL_TEAM_KEYWORDS)) {
    if (tA.includes(key.toLowerCase()) && keywords.some(kw => s.includes(kw) && s.indexOf(kw) < winIdx)) return teamA;
    if (tB.includes(key.toLowerCase()) && keywords.some(kw => s.includes(kw) && s.indexOf(kw) < winIdx)) return teamB;
  }

  return null;
}

async function computePlayerPoints(
  supabase: ReturnType<typeof createClient>,
  scorecard: NormalizedScorecard,
  matchId: string,
  playerIndex: PlayerIndex,
  dbPlayers: any[],
  dryRun: boolean
) {
  const upserts: any[] = [];
  const affectedPlayerIds: string[] = [];

  for (const ps of scorecard.players) {
    const dbPlayer = findPlayer(playerIndex, ps.name);
    if (!dbPlayer) continue;

    const bd = calculatePointsWithBreakdown(ps);
    let winBonus = 0;
    let motmBonus = 0;

    if (scorecard.winningTeam && dbPlayer.team) {
      const playerTeam = dbPlayer.team.toLowerCase();
      const winTeam = scorecard.winningTeam.toLowerCase();
      if (playerTeam === winTeam || playerTeam.includes(winTeam) || winTeam.includes(playerTeam)) {
        winBonus = 5;
      }
    }

    if (scorecard.playerOfTheMatch) {
      const motmNorm = normalizeName(scorecard.playerOfTheMatch);
      const psNorm = normalizeName(ps.name);
      if (psNorm === motmNorm || psNorm.includes(motmNorm) || motmNorm.includes(psNorm)) {
        motmBonus = 30;
        console.log("MOTM bonus +30 -> " + ps.name);
      }
    }

    const totalPoints = bd.total + winBonus + motmBonus;
    const breakdown = { ...bd, winning_bonus: winBonus, motm_bonus: motmBonus, total: totalPoints };

    upserts.push({
      match_id: matchId,
      player_id: dbPlayer.id,
      points: totalPoints,
      data_source: "cricbuzz",
      breakdown,
    });

    affectedPlayerIds.push(dbPlayer.id);
  }

  if (dryRun) {
    console.log("[DRY RUN] Would upsert " + upserts.length + " player points");
    if (upserts.length > 0) console.log("[DRY RUN] Sample:", JSON.stringify(upserts[0], null, 2));
    return;
  }

  if (upserts.length > 0) {
    await supabase
      .from("match_player_points")
      .upsert(upserts, { onConflict: "match_id,player_id" });
  }

  if (affectedPlayerIds.length > 0) {
    const { data: allPoints } = await supabase
      .from("match_player_points")
      .select("player_id, points")
      .in("player_id", affectedPlayerIds);

    const globalTotals = new Map<string, number>();
    for (const row of allPoints || []) {
      globalTotals.set(row.player_id, (globalTotals.get(row.player_id) || 0) + (row.points || 0));
    }

    for (const pid of affectedPlayerIds) {
      await supabase
        .from("players")
        .update({ points: globalTotals.get(pid) || 0, is_playing: true })
        .eq("id", pid);
    }
  }
}

function calculatePointsWithBreakdown(ps: PlayerStats): PointsBreakdown {
  const bd: PointsBreakdown = {
    starting_xi: 4, batting: 0, bowling: 0, fielding: 0,
    sr_bonus: 0, er_bonus: 0, milestone: 0, total: 0,
  };

  const runs = ps.runs || 0;
  const balls = ps.balls || 1;
  const fours = ps.fours || 0;
  const sixes = ps.sixes || 0;

  if (runs > 0 || ps.out !== undefined) {
    bd.batting += runs + fours * 4 + sixes * 6;

    if (balls >= 10) {
      const sr = (runs / Math.max(balls, 1)) * 100;
      if (sr > 170) bd.sr_bonus = 6;
      else if (sr >= 150) bd.sr_bonus = 4;
      else if (sr >= 130) bd.sr_bonus = 2;
      else if (sr < 50) bd.sr_bonus = -6;
      else if (sr < 60) bd.sr_bonus = -4;
      else if (sr < 70) bd.sr_bonus = -2;
    }

    if (runs >= 25) bd.milestone += 8;
    if (runs >= 50) bd.milestone += 8;
    if (runs >= 100) bd.milestone += 16;

    if (runs === 0 && ps.out) bd.batting -= 2;
  }

  const wickets = ps.wickets || 0;
  const overs = ps.oversBowled || 0;
  const runsConceded = ps.runsConceded || 0;

  if (wickets > 0 || overs > 0) {
    bd.bowling += wickets * 30 + (ps.maidens || 0) * 12;

    if (wickets >= 3) bd.milestone += 4;
    if (wickets >= 4) bd.milestone += 8;
    if (wickets >= 5) bd.milestone += 16;

    if (overs >= 2) {
      const economy = runsConceded / overs;
      if (economy < 5) bd.er_bonus = 6;
      else if (economy < 6) bd.er_bonus = 4;
      else if (economy < 7) bd.er_bonus = 2;
      else if (economy > 12) bd.er_bonus = -6;
      else if (economy > 11) bd.er_bonus = -4;
      else if (economy > 10) bd.er_bonus = -2;
    }
  }

  bd.fielding += (ps.catches || 0) * 8;
  bd.fielding += (ps.directRunOuts || 0) * 12;
  bd.fielding += (ps.indirectRunOuts || 0) * 6;
  bd.fielding += (ps.stumpings || 0) * 12;

  bd.total = bd.starting_xi + bd.batting + bd.bowling + bd.fielding + bd.sr_bonus + bd.er_bonus + bd.milestone;
  return bd;
}
async function recalcUserTeamPoints(
  supabase: ReturnType<typeof createClient>,
  matchId: string,
  dryRun: boolean
) {
  try {
    const { data: userTeams } = await supabase
      .from("user_teams")
      .select("id, captain_id, vice_captain_id, user_id")
      .eq("match_id", matchId);

    if (!userTeams?.length) return;

    const utIds = userTeams.map(ut => ut.id);
    const { data: allTeamPlayers } = await supabase
      .from("team_players")
      .select("user_team_id, player_id")
      .in("user_team_id", utIds);

    if (!allTeamPlayers?.length) return;

    const { data: allMatchPoints } = await supabase
      .from("match_player_points")
      .select("player_id, points")
      .eq("match_id", matchId);

    const pointsMap = new Map((allMatchPoints || []).map(mp => [mp.player_id, mp.points]));

    const teamPlayersMap = new Map<string, any[]>();
    for (const tp of allTeamPlayers) {
      if (!teamPlayersMap.has(tp.user_team_id)) teamPlayersMap.set(tp.user_team_id, []);
      teamPlayersMap.get(tp.user_team_id)!.push(tp);
    }

    const teamUpdates: { id: string; total_points: number }[] = [];
    for (const ut of userTeams) {
      const tps = teamPlayersMap.get(ut.id) || [];
      let total = 0;
      for (const tp of tps) {
        const pts = pointsMap.get(tp.player_id) || 0;
        if (tp.player_id === ut.captain_id) total += pts * 2;
        else if (tp.player_id === ut.vice_captain_id) total += pts * 1.5;
        else total += pts;
      }
      teamUpdates.push({ id: ut.id, total_points: parseFloat(total.toFixed(1)) });
    }

    if (dryRun) {
      console.log("[DRY RUN] Would update " + teamUpdates.length + " user teams");
      for (const tu of teamUpdates) console.log("[DRY RUN]   " + tu.id + ": " + tu.total_points + " pts");
      return;
    }

    for (const tu of teamUpdates) {
      await supabase.from("user_teams").update({ total_points: tu.total_points }).eq("id", tu.id);
    }

    const userIds = [...new Set(userTeams.map(ut => ut.user_id))];
    const { data: allUserTeams } = await supabase
      .from("user_teams")
      .select("user_id, total_points")
      .in("user_id", userIds);

    const profileTotals = new Map<string, number>();
    for (const ut of allUserTeams || []) {
      profileTotals.set(ut.user_id, (profileTotals.get(ut.user_id) || 0) + (ut.total_points || 0));
    }

    for (const [userId, total] of profileTotals) {
      await supabase.from("profiles").update({ total_points: total }).eq("user_id", userId);
    }
  } catch (err) {
    console.error("Error recalculating user team points:", matchId, err);
  }
}

function teamMatchesKeywords(teamName: string, target: string): boolean {
  const targetLower = target.toLowerCase();
  if (targetLower.includes(teamName.toLowerCase())) return true;
  for (const [key, keywords] of Object.entries(PSL_TEAM_KEYWORDS)) {
    if (teamName.toLowerCase().includes(key.toLowerCase())) {
      return keywords.some(kw => targetLower.includes(kw));
    }
  }
  return false;
}

function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z\s]/g, "")
    .trim();
}

function mergePlayer(players: PlayerStats[], incoming: PlayerStats) {
  const normalized = normalizeName(incoming.name);
  const existing = players.find(p => normalizeName(p.name) === normalized);
  if (existing) {
    if (incoming.runs !== undefined) {
      existing.runs = (existing.runs || 0) + (incoming.runs || 0);
      existing.balls = (existing.balls || 0) + (incoming.balls || 0);
      existing.fours = (existing.fours || 0) + (incoming.fours || 0);
      existing.sixes = (existing.sixes || 0) + (incoming.sixes || 0);
      if (incoming.out) existing.out = true;
    }
    if (incoming.wickets !== undefined || incoming.oversBowled !== undefined) {
      existing.wickets = (existing.wickets || 0) + (incoming.wickets || 0);
      existing.oversBowled = (existing.oversBowled || 0) + (incoming.oversBowled || 0);
      existing.runsConceded = (existing.runsConceded || 0) + (incoming.runsConceded || 0);
      existing.maidens = (existing.maidens || 0) + (incoming.maidens || 0);
    }
    if (incoming.catches !== undefined) existing.catches = (existing.catches || 0) + (incoming.catches || 0);
    if (incoming.directRunOuts !== undefined) existing.directRunOuts = (existing.directRunOuts || 0) + (incoming.directRunOuts || 0);
    if (incoming.indirectRunOuts !== undefined) existing.indirectRunOuts = (existing.indirectRunOuts || 0) + (incoming.indirectRunOuts || 0);
    if (incoming.stumpings !== undefined) existing.stumpings = (existing.stumpings || 0) + (incoming.stumpings || 0);
  } else {
    players.push({ ...incoming });
  }
}