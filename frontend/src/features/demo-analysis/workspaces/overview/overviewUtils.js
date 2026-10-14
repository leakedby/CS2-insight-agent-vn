import { translate } from "../../../../i18n/translate.js";
import { useLocaleStore } from "../../../../i18n/localeStore.js";

// Resolved at call time so non-React overview builders follow the active UI locale.
export function overviewLocale() {
  return useLocaleStore.getState().effectiveLocale;
}

export function tr(key, params) {
  return translate(overviewLocale(), key, params);
}

export function num(value, fallback = 0) {
  const result = Number(value);
  return Number.isFinite(result) ? result : fallback;
}

export function ratio(numerator, denominator) {
  return denominator > 0 ? numerator / denominator : 0;
}

export function percent(numerator, denominator, digits = 0) {
  return `${(ratio(numerator, denominator) * 100).toFixed(digits)}%`;
}

export function normalizeRounds(data) {
  return [...(data?.rounds || [])]
    .filter((round) => Number(round?.round_number) > 0)
    .sort((a, b) => Number(a.round_number) - Number(b.round_number));
}

export function buildPlayerTeamMap(players) {
  const map = new Map();
  for (const player of players || []) {
    if (player?.name) {
      map.set(String(player.name).trim().toLowerCase(), player.team_key);
    }
  }
  return map;
}

export function isValidEnemyKill(event, playerTeamMap) {
  if (event?.type !== "kill") return false;
  const { actor, target } = event;
  if (!actor || actor === target || actor === "World") return false;
  const actorTeam = playerTeamMap.get(String(actor).trim().toLowerCase());
  const targetTeam = playerTeamMap.get(String(target).trim().toLowerCase());
  if (!actorTeam || !targetTeam) return false;
  return actorTeam !== targetTeam;
}

// Parses Chinese numerals in backend-generated headlines; not display text.
const NUMERAL_KILLS = { 双: 2, 三: 3, 四: 4, 五: 5 };

export function multiKillLabel(count) {
  const n = Math.min(5, Number(count));
  return n >= 2 ? tr(`analysis.ov.multiKill${n}`) : tr("analysis.ov.multiKillN", { n: count });
}

function topKiller(counts) {
  let bestName = "";
  let bestCount = 0;
  for (const [name, count] of counts) {
    if (count > bestCount) {
      bestName = name;
      bestCount = count;
    }
  }
  return [bestName, bestCount];
}

export function buildRoundHeadline({
  events = [],
  playerTeamMap,
  winnerKey,
  winnerLabel,
  site,
  roundNumber,
}) {
  const winnerCounts = new Map();
  const loserCounts = new Map();
  for (const event of events || []) {
    if (event?.type !== "kill") continue;
    const actor = String(event.actor || "").trim();
    if (!actor || actor === "World") continue;
    const team = playerTeamMap?.get(actor.toLowerCase());
    if (!team) continue;
    const bucket = winnerKey && team === winnerKey ? winnerCounts : loserCounts;
    bucket.set(actor, (bucket.get(actor) || 0) + 1);
  }

  const [winnerPlayer, winnerKills] = topKiller(winnerCounts);
  const [loserPlayer, loserKills] = topKiller(loserCounts);
  if (loserKills >= 3 && loserKills > winnerKills) {
    return tr("analysis.ov.headlineLoserMulti", { player: loserPlayer, multi: multiKillLabel(loserKills), winner: winnerLabel });
  }
  if (winnerKills >= 2) {
    return tr("analysis.ov.headlineWinnerMulti", { player: winnerPlayer, multi: multiKillLabel(winnerKills), winner: winnerLabel });
  }
  if (site) return tr("analysis.ov.headlinePlant", { winner: winnerLabel, site });
  return tr("analysis.ov.headlineWin", { winner: winnerLabel, round: roundNumber });
}

export function rewriteStoredRoundHeadline(rawHeadline, options = {}) {
  const winnerLabel = options.winnerLabel || tr("analysis.ov.roundWinnerFallback");
  const teamAName = options.teamAName || "Team A";
  const teamBName = options.teamBName || "Team B";
  const headline = String(rawHeadline || "")
    .replaceAll("本回合胜方", winnerLabel)
    .replaceAll("A 队", teamAName)
    .replaceAll("B 队", teamBName);
  // Backend headlines are always Chinese and mirror buildRoundHeadline, so other locales regenerate them.
  if (overviewLocale() !== "zh") return headline ? buildRoundHeadline({ ...options, winnerLabel }) : headline;
  if (!/杀帮助 .+ 拿下回合$/.test(headline)) return headline;

  const hasKills = (options.events || []).some((event) => event?.type === "kill");
  if (hasKills) return buildRoundHeadline({ ...options, winnerLabel });

  const match = headline.match(/^(.*) ([双三四五\d]+)杀帮助 (.+) 拿下回合$/);
  if (!match) return headline;
  const player = match[1].trim();
  const numeral = match[2];
  const team = options.playerTeamMap?.get(player.toLowerCase());
  if (team && team === options.winnerKey) {
    return headline;
  }
  const killCount = NUMERAL_KILLS[numeral] || Number(numeral) || 0;
  if (team && killCount >= 3) {
    return tr("analysis.ov.headlineLoserMulti", { player, multi: multiKillLabel(killCount), winner: winnerLabel });
  }
  if (options.site) return tr("analysis.ov.headlinePlant", { winner: winnerLabel, site: options.site });
  return tr("analysis.ov.headlineWin", { winner: winnerLabel, round: options.roundNumber });
}

export function detectPhaseMeta(data, rounds) {
  const sortedRounds = [...rounds]
    .filter((round) => Number(round?.round_number) > 0)
    .sort((a, b) => Number(a.round_number) - Number(b.round_number));

  const phaseMeta = data?.phase_meta;
  let halftimeRound = null;
  let regulationEndRound = null;

  if (phaseMeta?.halftime_round != null) {
    halftimeRound = num(phaseMeta.halftime_round, null);
    regulationEndRound =
      phaseMeta.regulation_end_round != null
        ? num(phaseMeta.regulation_end_round, null)
        : halftimeRound > 1
          ? (halftimeRound - 1) * 2
          : null;
  } else {
    const firstSide = sortedRounds[0]?.team_a_side;
    const hasSideData = sortedRounds.some((r) => r.team_a_side != null);

    if (hasSideData && firstSide != null) {
      const flipRound = sortedRounds.find(
        (r, idx) => idx > 0 && r.team_a_side != null && r.team_a_side !== firstSide,
      );
      if (flipRound) {
        halftimeRound = flipRound.round_number;
        if (halftimeRound > 1) {
          regulationEndRound = (halftimeRound - 1) * 2;
        }
      }
    }

    if (halftimeRound == null && !hasSideData) {
      return {
        halftimeRound: null,
        regulationEndRound: null,
        firstHalfRounds: sortedRounds,
        secondHalfRounds: [],
        overtimeRounds: [],
      };
    }
  }

  let firstHalfRounds = [];
  let secondHalfRounds = [];
  let overtimeRounds = [];

  if (halftimeRound != null && regulationEndRound != null) {
    firstHalfRounds = sortedRounds.filter(
      (r) => r.round_number >= 1 && r.round_number < halftimeRound,
    );
    secondHalfRounds = sortedRounds.filter(
      (r) => r.round_number >= halftimeRound && r.round_number <= regulationEndRound,
    );
    overtimeRounds = sortedRounds.filter((r) => r.round_number > regulationEndRound);
  } else if (halftimeRound != null) {
    firstHalfRounds = sortedRounds.filter(
      (r) => r.round_number >= 1 && r.round_number < halftimeRound,
    );
    secondHalfRounds = sortedRounds.filter((r) => r.round_number >= halftimeRound);
  } else {
    firstHalfRounds = sortedRounds;
  }

  return {
    halftimeRound,
    regulationEndRound,
    firstHalfRounds,
    secondHalfRounds,
    overtimeRounds,
  };
}
