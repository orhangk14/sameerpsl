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

const PSL_TEAM_KEYWORDS: Record<string, string[]> = {
  "Quetta": ["quetta", "gladiators", "qtg", "que", "glad"],
  "Karachi": ["karachi", "krk", "kar"],
  "Lahore": ["lahore", "qalandars", "lhq", "lah", "qal"],
  "Islamabad": ["islamabad", "united", "isu", "isl"],
  "Peshawar": ["peshawar", "zalmi", "psz", "pes", "zal"],
  "Multan": ["multan", "sultans", "ms", "mul", "sul"],
  "Rawalpindi": ["rawalpindi", "pindiz", "rwp", "raw", "pin"],
  "Hyderabad": ["hyderabad", "kingsmen", "hydk", "hyd"],
};

function extractWinningTeam(statusText: string | undefined | null, teamA: string, teamB: string, teamAScore?: string | null, teamBScore?: string | null): string | null {
  // PRIMARY: Compare scores (works for 99% of T20 matches)
  if (teamAScore && teamBScore) {
    const aRuns = parseInt(teamAScore.split('/')[0]) || 0;
    const bRuns = parseInt(teamBScore.split('/')[0]) || 0;
    if (bRuns > aRuns) return teamB;
    if (aRuns > bRuns) return teamA;
  }

  // FALLBACK: Parse status text
  if (!statusText) return null;
  const s = statusText.toLowerCase();
  if (!s.includes("won by") && !s.includes("beat")) return null;

  const winIdx = s.includes("won by") ? s.indexOf("won by") : s.indexOf("beat");
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

  return null;
}

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

    // Auto-transition upcoming -> live
    const { data: pendingMatches } = await supabase
      .from("matches")
      .select("id, cricbuzz_match_id, team_a, team_b")
      .eq("status", "upcoming")
      .lte("match_date", now.toISOString());

    if (pendingMatches?.length) {
      for (const pm of pendingMatches) {
        if (!pm.cricbuzz_match_id) continue;
        const { data: html } = await supabase.rpc("http_get_text", {
          target_url: `https://www.cricbuzz.com/live-cricket-scores/${pm.cricbuzz_match_id}`
        });
        if (html && isScopedState(html, pm.team_a, pm.team_b, "In Progress")) {
          if (!dryRun) {
            await supabase.from("matches").update({ status: "live" }).eq("id", pm.id);
          }
          console.log(`${dryRun ? "[DRY RUN] " : ""}Transitioned ${pm.team_a} vs ${pm.team_b} to live`);
        }
      }
    }

    const { data: liveMatches } = await supabase
      .from("matches")
      .select("id, cricbuzz_match_id, team_a, team_b, status, team_a_score, team_b_score")
      .eq("status", "live");

    // MOTM re-check for recently completed matches
    const { data: recentCompleted } = await supabase
      .from("matches")
      .select("id, cricbuzz_match_id, team_a, team_b")
      .eq("status", "completed")
      .gte("match_date", sixHoursAgo);

    if (recentCompleted?.length) {
      for (const rm of recentCompleted) {
        if (!rm.cricbuzz_match_id) continue;

        // Completion integrity check — revert if Cricbuzz still says In Progress
        const { data: integrityHtml } = await supabase.rpc("http_get_text", {
          target_url: `https://www.cricbuzz.com/live-cricket-scores/${rm.cricbuzz_match_id}`
        });
        if (integrityHtml && isScopedState(integrityHtml, rm.team_a, rm.team_b, "In Progress")) {
          console.warn(`INTEGRITY: ${rm.team_a} vs ${rm.team_b} still In Progress — reverting to live`);
          if (!dryRun) {
            await supabase.from("matches").update({ status: "live", winning_team: null }).eq("id", rm.id);
          }
          liveMatches?.push({ ...rm, status: "live", team_a_score: null, team_b_score: null });
          continue;
        }

        // MOTM check
        const { data: motmCheck } = await supabase
          .from("match_player_points")
          .select("id")
          .eq("match_id", rm.id)
          .gt("breakdown->motm_bonus", 0)
          .limit(1);

        if (motmCheck?.length) continue;

        if (!integrityHtml) continue;

        const motmName = findMotmName(integrityHtml);
        if (!motmName) continue;

        console.log(`MOTM re-check: ${motmName} for ${rm.team_a} vs ${rm.team_b}`);

        const { data: dbPlayers } = await supabase.from("players").select("id, name");
        const motmNorm = normalizeName(motmName);
        const motmPlayer = dbPlayers?.find(
          (p: any) => normalizeName(p.name) === motmNorm ||
            normalizeName(p.name).includes(motmNorm) ||
            motmNorm.includes(normalizeName(p.name))
        );

        if (!motmPlayer) continue;

        const { data: existing } = await supabase
          .from("match_player_points")
          .select("id, breakdown, points")
          .eq("match_id", rm.id)
          .eq("player_id", motmPlayer.id)
          .single();

        if (!existing || existing.breakdown?.motm_bonus > 0) continue;

        const newTotal = (existing.breakdown?.total || 0) + 30;
        const newBreakdown = { ...existing.breakdown, motm_bonus: 30, total: newTotal };

        if (!dryRun) {
          await supabase
            .from("match_player_points")
            .update({ breakdown: newBreakdown, points: existing.points + 30 })
            .eq("id", existing.id);

          await recalcUserTeamPoints(supabase, rm.id);

          const { data: affectedTeams } = await supabase
            .from("user_teams")
            .select("user_id")
            .eq("match_id", rm.id);

          if (affectedTeams) {
            for (const ut of affectedTeams) {
              const { data: allTeams } = await supabase
                .from("user_teams")
                .select("total_points, match_id")
                .eq("user_id", ut.user_id);

              const teamMatchIds = (allTeams || []).map((t: any) => t.match_id);
              const { data: mDates } = await supabase
                .from("matches")
                .select("id, match_date")
                .in("id", teamMatchIds);

              const mDateMap = new Map((mDates || []).map((m: any) => [m.id, m.match_date]));
              const cutoff = new Date("2026-04-13T00:00:00Z").getTime();

              const totalProfile = (allTeams || []).reduce((s: number, t: any) => {
                const mDate = new Date(mDateMap.get(t.match_id) || 0).getTime();
                return mDate >= cutoff ? s + (t.total_points || 0) : s;
              }, 0);

              const { data: prof } = await supabase
                .from("profiles")
                .select("old_app_points")
                .eq("user_id", ut.user_id)
                .single();
              const oldPts = prof?.old_app_points || 0;
              await supabase.from("profiles").update({ total_points: totalProfile + oldPts }).eq("user_id", ut.user_id);
            }
          }
        }
        console.log(`${dryRun ? "[DRY RUN] " : ""}MOTM +30 applied to ${motmPlayer.name}`);
      }
    }

    if (!liveMatches?.length) {
      return new Response(
        JSON.stringify({ success: true, message: "No live matches to update", updated: 0 }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const aliasMap = await loadAliasMap(supabase);
    let updated = 0;

    // Replace the entire for (const match of liveMatches) block with:

    for (const match of liveMatches) {
      try {
        if (!match.cricbuzz_match_id) {
          console.log(`Match ${match.id} has no cricbuzz_match_id — skipping`);
          continue;
        }

        // STEP 1: Fetch scores page ONCE
        const result = await fetchScoresPage(match.cricbuzz_match_id, match, supabase);
        if (!result) {
          console.log(`No score data for match ${match.id}`);
          continue;
        }

        const { html: scoresHtml, scorecard } = result;

        // Update scores display
        const scoreUpdate: any = {};
        if (scorecard.teamAScore !== null) scoreUpdate.team_a_score = scorecard.teamAScore;
        if (scorecard.teamBScore !== null) scoreUpdate.team_b_score = scorecard.teamBScore;
        if (Object.keys(scoreUpdate).length > 0 && !dryRun) {
          await supabase.from("matches").update(scoreUpdate).eq("id", match.id);
        }

        // STEP 2: Fetch scorecard page ONCE (reuses scores HTML for miniscore fallback)
        const players = await fetchScorecardPlayers(match.cricbuzz_match_id, scoresHtml, supabase);
        const fullScorecard = { ...scorecard, players };

        if (players.length > 0) {
          await computePlayerPoints(supabase, fullScorecard, match.id, aliasMap, dryRun);
          await recalcUserTeamPoints(supabase, match.id, dryRun);
          console.log(`Points updated for ${players.length} players`);
        }

        // STEP 3: Handle completion with delayed stable-score check
        if (scorecard.matchEnded) {
          const storedA = match.team_a_score || "";
          const storedB = match.team_b_score || "";
          const newA = scorecard.teamAScore || "";
          const newB = scorecard.teamBScore || "";
          const scoresStable = storedA === newA && storedB === newB && storedA !== "";

          if (!scoresStable) {
            console.log(`Match ${match.id} completion detected but scores not stable — keeping live`);
          } else {
            console.log(`Match ${match.id} confirmed complete — finalizing`);
            if (!dryRun) {
              await supabase.from("players").update({ is_playing: null }).eq("is_playing", true).in("team", [match.team_a, match.team_b]);
              const completionUpdate: any = { status: "completed" };
              if (fullScorecard.winningTeam) completionUpdate.winning_team = fullScorecard.winningTeam;
              if (fullScorecard.teamAScore) completionUpdate.team_a_score = fullScorecard.teamAScore;
              if (fullScorecard.teamBScore) completionUpdate.team_b_score = fullScorecard.teamBScore;
              await supabase.from("matches").update(completionUpdate).eq("id", match.id);

              // ─── Penalty for missing users (lowest - 30) ─────────────
            }
          }
        }

        updated++;
      } catch (matchErr) {
        console.error(`Error updating match ${match.id}:`, matchErr);
      }
    }

    return new Response(
      JSON.stringify({ success: true, updated, dryRun }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: unknown) {
    console.error("Live sync error:", error);
    const msg = error instanceof Error ? error.message : "Unknown error";
    return new Response(JSON.stringify({ success: false, error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

// ─── Scoped state detection ─────────────────────────────────────────────────

function isScopedState(html: string, teamA: string, teamB: string, state: string): boolean {
  const fullA = teamA.split(' ')[0].toLowerCase();
  const fullB = teamB.split(' ')[0].toLowerCase();
  const safeState = state.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regex = new RegExp(safeState, "g");
  let m;
  while ((m = regex.exec(html)) !== null) {
    const start = Math.max(0, m.index - 500);
    const end = Math.min(html.length, m.index + 500);
    const context = html.substring(start, end).toLowerCase();
    if (context.includes(fullA) && context.includes(fullB)) return true;
  }
  return false;
}

// ─── MOTM string parser (no regex, no bracket corruption) ───────────────────

function findMotmName(html: string): string | null {
  const marker = "playersOfTheMatch";
  const pos = html.indexOf(marker);
  if (pos === -1) return null;

  const chunk = html.substring(pos, Math.min(html.length, pos + 2000));
  let searchFrom = 0;
  while (searchFrom < chunk.length) {
    const namePos = chunk.indexOf("name", searchFrom);
    if (namePos === -1) break;
    const colonPos = chunk.indexOf(":", namePos + 4);
    if (colonPos === -1) break;

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
    if (name.length > 2 && !isTeamName(name)) return name;
    searchFrom = end;
  }
  return null;
}

function isTeamName(name: string): boolean {
  const lower = name.toLowerCase();
  for (const [key, keywords] of Object.entries(PSL_TEAM_KEYWORDS)) {
    if (lower.includes(key.toLowerCase())) return true;
    for (const kw of keywords) {
      if (lower.includes(kw) && lower.length < 25) return true;
    }
  }
  return false;
}

// ─── Alias map ──────────────────────────────────────────────────────────────

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

// ─── Cricbuzz fetch ─────────────────────────────────────────────────────────

// ─── Replace tryCricbuzz with two separate functions ────────────────────────

async function fetchScoresPage(
  cricbuzzId: string,
  match: any,
  supabase: any
): Promise<{ html: string; scorecard: NormalizedScorecard } | null> {
  try {
    const { data: html, error } = await supabase.rpc("http_get_text", {
      target_url: `https://www.cricbuzz.com/live-cricket-scores/${cricbuzzId}`
    });
    if (error || !html) return null;

    const hasComplete = isScopedState(html, match.team_a, match.team_b, "Complete");
    const hasInProgress = isScopedState(html, match.team_a, match.team_b, "In Progress");
    const matchEnded = hasComplete && !hasInProgress;

    let teamAScore: string | null = null;
    let teamBScore: string | null = null;

    const inningsRegex = /\\?"inningsId\\?":\s*(\d+)\s*,\s*\\?"batTeamId\\?":\s*\d+\s*,\s*\\?"batTeamName\\?":\s*\\?"([^"\\]+)\\?"\s*,\s*\\?"score\\?":\s*(\d+)\s*,\s*\\?"wickets\\?":\s*(\d+)\s*,\s*\\?"overs\\?":\s*([\d.]+)/g;
    const inningsByid = new Map<string, { team: string; score: string }>();
    let im;
    while ((im = inningsRegex.exec(html)) !== null) {
      inningsByid.set(im[1], { team: im[2], score: `${im[3]}/${im[4]} (${im[5]})` });
    }

    for (const inn of inningsByid.values()) {
      if (teamMatchesKeywords(match.team_a, inn.team)) {
        teamAScore = inn.score;
      } else if (teamMatchesKeywords(match.team_b, inn.team)) {
        teamBScore = inn.score;
      }
    }

    if (!teamAScore && !teamBScore) {
      const titleRegex = /(\w+)\s+(\d+)\/(\d+)\s*\(([\d.]+)\)/g;
      let tm;
      while ((tm = titleRegex.exec(html)) !== null) {
        const score = `${tm[2]}/${tm[3]} (${tm[4]})`;
        if (!teamAScore) teamAScore = score;
        else if (!teamBScore && score !== teamAScore) { teamBScore = score; break; }
      }
    }

    if (!teamAScore && !teamBScore) return null;

    let winningTeam: string | null = null;
    if (matchEnded) {
      // Try score comparison first
      winningTeam = extractWinningTeam(null, match.team_a, match.team_b, teamAScore, teamBScore);
      
      // Fallback to status text only if scores are tied
      if (!winningTeam) {
        const statusRegex = /\\*"?status\\*"?\s*:\s*\\*"?([^"\\]{5,80})\\*"?/g;
        let sm;
        while ((sm = statusRegex.exec(html)) !== null) {
          const result = extractWinningTeam(sm[1], match.team_a, match.team_b);
          if (result) { winningTeam = result; break; }
        }
      }
    }

    const playerOfTheMatch = findMotmName(html);
    if (playerOfTheMatch) console.log(`Cricbuzz: MOTM = ${playerOfTheMatch}`);

    console.log(`Cricbuzz: ${teamAScore} / ${teamBScore}, ended=${matchEnded}, winner=${winningTeam}`);
    return {
      html,
      scorecard: { teamAScore, teamBScore, matchEnded, players: [], winningTeam, playerOfTheMatch }
    };
  } catch (err) {
    console.log(`Cricbuzz scores failed:`, err);
    return null;
  }
}

function parsePlayersFromScoresPage(html: string): PlayerStats[] {
  const players: PlayerStats[] = [];
  const batRegex = /\\?"(?:batsmanStriker|batsmanNonStriker)\\?":\s*\{[^}]*?\\?"name\\?":\s*\\?"([^"\\]+)\\?"[^}]*?\\?"runs\\?":\s*(\d+)[^}]*?\\?"balls\\?":\s*(\d+)[^}]*?\\?"fours\\?":\s*(\d+)[^}]*?\\?"sixes\\?":\s*(\d+)/g;
  let bm;
  while ((bm = batRegex.exec(html)) !== null) {
    if (bm[1] && bm[1] !== "undefined") {
      mergePlayer(players, { name: bm[1], runs: parseInt(bm[2]) || 0, balls: parseInt(bm[3]) || 0, fours: parseInt(bm[4]) || 0, sixes: parseInt(bm[5]) || 0 });
    }
  }
  const bowlRegex = /\\?"(?:bowlerStriker|bowlerNonStriker)\\?":\s*\{[^}]*?\\?"name\\?":\s*\\?"([^"\\]+)\\?"[^}]*?\\?"overs\\?":\s*([\d.]+)[^}]*?\\?"maidens\\?":\s*(\d+)[^}]*?\\?"runs\\?":\s*(\d+)[^}]*?\\?"wickets\\?":\s*(\d+)/g;
  let bwm;
  while ((bwm = bowlRegex.exec(html)) !== null) {
    if (bwm[1] && bwm[1] !== "undefined") {
      mergePlayer(players, { name: bwm[1], oversBowled: parseFloat(bwm[2]) || 0, maidens: parseInt(bwm[3]) || 0, runsConceded: parseInt(bwm[4]) || 0, wickets: parseInt(bwm[5]) || 0 });
    }
  }
  const lastWicketRegex = /\\?"lastWicket\\?":\s*\\?"([^"\\]+)\s+(\d+)\((\d+)\)/g;
  let lwm;
  while ((lwm = lastWicketRegex.exec(html)) !== null) {
    const name = lwm[1].trim().replace(/\s+[cb]\s+.*/, '').trim();
    if (name && name.length > 2) {
      mergePlayer(players, { name, runs: parseInt(lwm[2]) || 0, balls: parseInt(lwm[3]) || 0, out: true });
    }
  }
  return players;
}

async function fetchScorecardPlayers(
  cricbuzzId: string,
  scoresHtml: string,
  supabase: any
): Promise<PlayerStats[]> {
  try {
    const { data: scHtml, error } = await supabase.rpc("http_get_text", {
      target_url: `https://www.cricbuzz.com/live-cricket-scorecard/${cricbuzzId}`
    });
    if (!error && scHtml && scHtml.length > 1000) {
      const scorecardPlayers = parseScorecardPlayers(scHtml);
      const merged: PlayerStats[] = [];
      for (const sp of scorecardPlayers) mergePlayer(merged, sp);
      console.log(`Cricbuzz: ${scorecardPlayers.length} players from scorecard`);
      return merged;
    }
  } catch (err) {
    console.log(`Scorecard fetch failed:`, err);
  }

  // Miniscore fallback — use already-fetched scores page
  console.log(`Cricbuzz: using miniscore fallback`);
  return parsePlayersFromScoresPage(scoresHtml);
}

// ─── Scorecard parser ───────────────────────────────────────────────────────

function parseScorecardPlayers(html: string): PlayerStats[] {
  const players: PlayerStats[] = [];

  const batRegex = /\\?"batName\\?":\s*\\?"([^"\\]+)\\?"[^}]*?\\?"runs\\?":\s*(\d+)[^}]*?\\?"balls\\?":\s*(\d+)[^}]*?\\?"fours\\?":\s*(\d+)[^}]*?\\?"sixes\\?":\s*(\d+)/g;
  let bm;
  while ((bm = batRegex.exec(html)) !== null) {
    const name = bm[1];
    if (!name || name === "undefined") continue;

    const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const outDescRegex = new RegExp(`\\\\?"batName\\\\?":\\s*\\\\?"${escapedName}\\\\?"[^}]*?\\\\?"outDesc\\\\?":\\s*\\\\?"([^"\\\\]*?)\\\\?"`, 'g');
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

function extractFieldingFromOutDesc(players: PlayerStats[], outDesc: string) {
  const cleaned = outDesc.replace(/†/g, '').trim();

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
    const fielders = runOutMatch[1].trim().split('/').map(f => f.trim()).filter(f => f.length > 1);
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

// ─── Compute player points ─────────────────────────────────────────────────

async function computePlayerPoints(
  supabase: ReturnType<typeof createClient>,
  scorecard: NormalizedScorecard,
  matchId: string,
  aliasMap: Map<string, string>,
  dryRun: boolean
) {
  const { data: dbPlayers } = await supabase
    .from("players")
    .select("id, name, team, external_id");

  if (!dbPlayers?.length) return;

  const affectedPlayerIds: string[] = [];

  for (const ps of scorecard.players) {
    const normalizedPs = normalizeName(ps.name);
    let dbPlayer = dbPlayers.find(
      (dp: any) => normalizeName(dp.name) === normalizedPs
    ) || dbPlayers.find(
      (dp: any) => normalizeName(dp.name).includes(normalizedPs) ||
                   normalizedPs.includes(normalizeName(dp.name))
    );

    if (!dbPlayer) {
      const aliasPlayerId = aliasMap.get(normalizedPs);
      if (aliasPlayerId) {
        dbPlayer = dbPlayers.find((dp: any) => dp.id === aliasPlayerId);
      }
    }

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
      if (normalizedPs === motmNorm || normalizedPs.includes(motmNorm) || motmNorm.includes(normalizedPs)) {
        motmBonus = 30;
        console.log(`MOTM bonus +30 applied to ${ps.name}`);
      }
    }

    const totalPoints = bd.total + winBonus + motmBonus;
    const breakdown = { ...bd, winning_bonus: winBonus, motm_bonus: motmBonus, total: totalPoints };

    if (!dryRun) {
      // Per-player upsert (proven to work)
      await supabase.from("match_player_points").upsert(
        { match_id: matchId, player_id: dbPlayer.id, points: totalPoints, data_source: "cricbuzz", breakdown },
        { onConflict: "match_id,player_id" }
      );
    }

    affectedPlayerIds.push(dbPlayer.id);
  }

  // BATCH global totals — one read for all affected players instead of per-player
  if (!dryRun && affectedPlayerIds.length > 0) {
    const { data: allPoints } = await supabase
      .from("match_player_points")
      .select("player_id, points")
      .in("player_id", affectedPlayerIds);

    const globalTotals = new Map<string, number>();
    for (const row of allPoints || []) {
      globalTotals.set(row.player_id, (globalTotals.get(row.player_id) || 0) + (row.points || 0));
    }

    for (const pid of affectedPlayerIds) {
      await supabase.from("players").update({ points: globalTotals.get(pid) || 0, is_playing: true }).eq("id", pid);
    }
  }

  console.log(`Points: ${affectedPlayerIds.length} players processed`);
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

// ─── User team recalculation ────────────────────────────────────────────────

async function recalcUserTeamPoints(
  supabase: ReturnType<typeof createClient>,
  matchId: string,
  dryRun?: boolean
) {
  try {
    const { data: userTeams } = await supabase
      .from("user_teams")
      .select("id, captain_id, vice_captain_id, user_id")
      .eq("match_id", matchId);

    if (!userTeams?.length) return;

    // BATCH: single query for all team players
    const utIds = userTeams.map(ut => ut.id);
    const { data: allTeamPlayers } = await supabase
      .from("team_players")
      .select("user_team_id, player_id")
      .in("user_team_id", utIds);

    if (!allTeamPlayers?.length) return;

    // BATCH: single query for all match points (by match_id only — fast)
    const { data: allMatchPoints } = await supabase
      .from("match_player_points")
      .select("player_id, points")
      .eq("match_id", matchId);

    const pointsMap = new Map((allMatchPoints || []).map((mp: any) => [mp.player_id, mp.points]));

    // Group team players in memory
    const teamPlayersMap = new Map<string, any[]>();
    for (const tp of allTeamPlayers) {
      if (!teamPlayersMap.has(tp.user_team_id)) teamPlayersMap.set(tp.user_team_id, []);
      teamPlayersMap.get(tp.user_team_id)!.push(tp);
    }

    // Calculate + write per team
    for (const ut of userTeams) {
      const tps = teamPlayersMap.get(ut.id) || [];
      let total = 0;
      for (const tp of tps) {
        const pts = pointsMap.get(tp.player_id) || 0;
        if (tp.player_id === ut.captain_id) total += pts * 2;
        else if (tp.player_id === ut.vice_captain_id) total += pts * 1.5;
        else total += pts;
      }
      if (!dryRun) {
        await supabase.from("user_teams").update({ total_points: parseFloat(total.toFixed(1)) }).eq("id", ut.id);
      }
    }

    // BATCH: only sum user_teams from match 22 onwards (Apr 13+)
    const userIds = [...new Set(userTeams.map((ut: any) => ut.user_id))];
    const { data: allUserTeams } = await supabase
      .from("user_teams")
      .select("user_id, total_points, match_id")
      .in("user_id", userIds);

    // Get match dates to filter
    const matchIds = [...new Set((allUserTeams || []).map((ut: any) => ut.match_id))];
    const { data: matchDates } = await supabase
      .from("matches")
      .select("id, match_date")
      .in("id", matchIds);

    const matchDateMap = new Map((matchDates || []).map((m: any) => [m.id, m.match_date]));
    const cutoff = new Date("2026-04-13T00:00:00Z").getTime();

    const profileTotals = new Map<string, number>();
    for (const ut of allUserTeams || []) {
      const mDate = new Date(matchDateMap.get(ut.match_id) || 0).getTime();
      if (mDate >= cutoff) {
        profileTotals.set(ut.user_id, (profileTotals.get(ut.user_id) || 0) + (ut.total_points || 0));
      }
    }

    for (const [userId, total] of profileTotals) {
      if (!dryRun) {
        const { data: prof } = await supabase
          .from("profiles")
          .select("old_app_points")
          .eq("user_id", userId)
          .single();
        const oldPts = prof?.old_app_points || 0;
        await supabase.from("profiles")
          .update({ total_points: total + oldPts })
          .eq("user_id", userId);
      }
    }
  } catch (err) {
    console.error("Error recalculating user team points:", matchId, err);
  }
}


// ─── Utilities ──────────────────────────────────────────────────────────────

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