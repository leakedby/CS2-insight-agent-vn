import { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import {
  Activity,
  ArrowLeft,
  Bomb,
  Crosshair,
  Filter,
  Gauge,
  MapPin,
  ShieldCheck,
  Swords,
  Zap,
} from "lucide-react";
import Button from "../../../components/ui/Button";
import KillfeedIconStrip from "./timeline/killfeed/KillfeedIconStrip";
import { buildOverviewModel } from "./overview/buildOverviewModel";
import MatchMainlineCard from "./overview/MatchMainlineCard";
import MatchTrendCard from "./overview/MatchTrendCard";
import SidePerformanceCard from "./overview/SidePerformanceCard";
import EconomyInsightCard from "./overview/EconomyInsightCard";
import OpeningAdvantageCard from "./overview/OpeningAdvantageCard";
import BombObjectiveCard from "./overview/BombObjectiveCard";
import PlayerEventsCard from "./overview/PlayerEventsCard";
import KeyRoundsTimeline from "./overview/KeyRoundsTimeline";
import { playerIdentityKey } from "../../../utils/playerIdentity.js";
import { useT } from "../../../i18n/useT.js";
import { buildPlayerTeamMap, rewriteStoredRoundHeadline } from "./overview/overviewUtils";

export function Panel({ title, eyebrow, action, children, className = "" }) {
  return (
    <section className={`analysis-panel ${className}`}>
      {(title || eyebrow || action) && (
        <header className="flex min-h-11 items-center justify-between gap-3 border-b border-cs2-border-subtle px-4 py-2.5">
          <div className="min-w-0">
            {eyebrow && <p className="mb-0.5 text-[9px] font-bold uppercase tracking-[0.18em] text-cs2-accent">{eyebrow}</p>}
            {title && <h2 className="truncate text-[13px] font-bold text-cs2-text-primary">{title}</h2>}
          </div>
          {action}
        </header>
      )}
      {children}
    </section>
  );
}

export function MetricCard({ icon: Icon, label, value, detail, tone = "accent" }) {
  const tones = {
    accent: "bg-cs2-accent-soft/45 text-cs2-accent",
    blue: "bg-sky-500/8 text-sky-400",
    green: "bg-emerald-500/8 text-emerald-400",
    violet: "bg-violet-500/8 text-violet-400",
  };
  return (
    <div
      data-testid="analysis-metric-card"
      className={`flex min-w-0 items-center gap-3 rounded-[10px] px-3.5 py-2.5 ${tones[tone] || tones.accent}`}
    >
      <div className="flex h-8 w-8 shrink-0 items-center justify-center"><Icon className="h-4 w-4" /></div>
      <div className="min-w-0"><p className="text-[9px] font-semibold uppercase tracking-wider text-cs2-text-muted">{label}</p><p className="mt-0.5 truncate text-lg font-black tabular-nums text-cs2-text-primary">{value}</p><p className="truncate text-[9px] text-cs2-text-muted">{detail}</p></div>
    </div>
  );
}

function teamDot(teamKey) {
  return teamKey === "a" ? "bg-sky-400" : "bg-amber-400";
}

function money(value) {
  return `$${(Number(value || 0) / 1000).toFixed(1)}K`;
}

const ECONOMY_LABEL_KEYS = { pistol: "analysis.ws.ecoPistol", full: "analysis.ws.ecoFull", force: "analysis.ws.ecoForce", semi: "analysis.ws.ecoSemi", eco: "analysis.ws.ecoEco" };

function economyLabel(type, t) {
  return t(ECONOMY_LABEL_KEYS[type] || "analysis.ws.ecoSemi");
}

function scoreText(round) {
  return `${Number(round?.team_a_score_after || 0)} : ${Number(round?.team_b_score_after || 0)}`;
}

function durationText(seconds) {
  const value = Math.max(0, Math.round(Number(seconds || 0)));
  return `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`;
}

function fallbackWorkspace({ players = [], meta = {}, teamAName, teamBName }) {
  const pivot = Math.ceil(players.length / 2);
  const stats = players.map((player, index) => {
    const kills = Number(player.kills || 0);
    const deaths = Number(player.deaths || 0);
    return {
      name: player.name || player.player_name || `Player ${index + 1}`,
      team_key: Number(player.team ?? player.team_number) === 3 ? "b" : Number(player.team ?? player.team_number) === 2 ? "a" : index < pivot ? "a" : "b",
      kills,
      deaths,
      assists: Number(player.assists || 0),
      kd: Number(player.kd || kills / Math.max(1, deaths)),
      adr: Number(player.adr || 0),
      kast: Number(player.kast || 0),
      hs_percent: Number(player.hs_percent || player.hs || 0),
      first_kills: Number(player.first_kills || 0),
      trade_kills: Number(player.trade_kills || 0),
      awp_kills: Number(player.awp_kills || 0),
      utility_damage: Number(player.utility_damage || 0),
    };
  });
  return {
    players: stats,
    rounds: [],
    team_a_name: teamAName,
    team_b_name: teamBName,
    team_a_score: Number(meta.team_a_score || 0),
    team_b_score: Number(meta.team_b_score || 0),
    summary: { total_rounds: Number(meta.total_rounds || 0) },
  };
}

export function useWorkspaceData(workspace, fallback) {
  const t = useT();
  return useMemo(() => {
    const base = workspace?.version ? workspace : fallbackWorkspace(fallback);
    let teamAScore = 0;
    let teamBScore = 0;
    const sourceRounds = Array.isArray(base.rounds) ? base.rounds : [];
    const playerTeamMap = buildPlayerTeamMap(base.players);
    const rounds = sourceRounds.map((round, index) => {
      const nextStartTick = Number(sourceRounds[index + 1]?.start_tick || 0);
      const formalEndTick = Number(round.round_end_tick ?? round.end_tick ?? 0);
      const replayEndTick = nextStartTick > formalEndTick ? nextStartTick - 1 : Number(round.end_tick || formalEndTick);
      let winnerKey = round.winner_team_key;
      const winnerSide = Number(round.winner_side || 0);
      if (!winnerKey && winnerSide) {
        if ((winnerSide === 2 && round.team_a_side === "T") || (winnerSide === 3 && round.team_a_side === "CT")) winnerKey = "a";
        else if ((winnerSide === 2 && round.team_b_side === "T") || (winnerSide === 3 && round.team_b_side === "CT")) winnerKey = "b";
      }
      const scoreBeforeA = teamAScore;
      const scoreBeforeB = teamBScore;
      if (winnerKey === "a") teamAScore += 1;
      if (winnerKey === "b") teamBScore += 1;
      const teamAName = base.team_a_name || fallback.teamAName || "Team A";
      const teamBName = base.team_b_name || fallback.teamBName || "Team B";
      const winnerLabel = winnerKey === "a" ? teamAName : winnerKey === "b" ? teamBName : t("analysis.ws.roundWinnerFallback");
      const headline = rewriteStoredRoundHeadline(round.headline || "", {
        events: round.events,
        playerTeamMap,
        winnerKey,
        winnerLabel,
        teamAName,
        teamBName,
        site: round.site,
        roundNumber: round.round_number,
      });
      return {
        ...round,
        round_end_tick: formalEndTick,
        end_tick: replayEndTick,
        winner_team_key: winnerKey,
        headline,
        duration_seconds: replayEndTick > Number(round.freeze_end_tick || 0)
          ? Math.round((replayEndTick - Number(round.freeze_end_tick || 0)) / Math.max(1, Number(base.tick_rate || 64)))
          : Number(round.duration_seconds || 0),
        team_a_score_before: scoreBeforeA,
        team_b_score_before: scoreBeforeB,
        team_a_score_after: teamAScore,
        team_b_score_after: teamBScore,
      };
    });
    return {
      ...base,
      team_a_name: base.team_a_name || fallback.teamAName || "Team A",
      team_b_name: base.team_b_name || fallback.teamBName || "Team B",
      team_a_score: Number(base.team_a_score ?? fallback.meta?.team_a_score ?? 0),
      team_b_score: Number(base.team_b_score ?? fallback.meta?.team_b_score ?? 0),
      players: Array.isArray(base.players) ? base.players : [],
      rounds,
    };
  }, [workspace, fallback, t]);
}

function TeamScoreboard({ teamKey, name, score, players, onSelectPlayer, winner = false }) {
  const t = useT();
  const isBlue = teamKey === "a";
  return (
    <section
      data-testid={`overview-team-scoreboard-${teamKey}`}
      data-winner={winner ? "true" : "false"}
      className={`min-w-0 overflow-hidden rounded-lg border bg-cs2-bg-card ${isBlue ? "border-cyan-500/45" : "border-amber-500/45"}`}
    >
      <header
        data-testid={`overview-team-scoreboard-header-${teamKey}`}
        className={`flex items-center justify-between border-b border-cs2-border px-3 py-2 ${isBlue ? "bg-cs2-cyan-surface text-cs2-cyan-on-surface" : "bg-cs2-amber-surface text-cs2-amber-on-surface"}`}
      >
        <div className="flex min-w-0 items-center gap-2">
          <span
            data-testid={`overview-team-scoreboard-mark-${teamKey}`}
            className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-sm font-black ${isBlue ? "bg-cs2-cyan-on-surface text-cs2-cyan-surface" : "bg-cs2-amber-on-surface text-cs2-amber-surface"}`}
          >
            {name.slice(0, 1).toUpperCase()}
          </span>
          <h3 className="truncate text-[11px] font-black tracking-wider">{name}</h3>
        </div>
        <span className="font-mono text-xl font-black">{score}</span>
      </header>
      <div className="overflow-hidden">
        <table className="w-full table-fixed border-collapse text-left">
          <colgroup>
            <col className="w-[28%]" />
            {Array.from({ length: 9 }).map((_, index) => <col key={index} className="w-[8%]" />)}
          </colgroup>
          <thead className="border-b border-cs2-border bg-cs2-bg-input text-[7px] uppercase tracking-wide text-cs2-text-muted">
            <tr>
              <th className="px-2 py-1.5">{t("analysis.ws.colPlayer")}</th>
              <th className="px-1 text-right">K</th>
              <th className="px-1 text-right">D</th>
              <th className="px-1 text-right">A</th>
              <th className="px-1 text-right">ADR</th>
              <th className="px-1 text-right">KAST</th>
              <th className="px-1 text-right">HS%</th>
              <th className="px-1 text-right">{t("analysis.ws.colFirstKills")}</th>
              <th className="px-1 text-right">AWP</th>
              <th className="px-2 text-right">{t("analysis.ws.colUtility")}</th>
            </tr>
          </thead>
          <tbody>
            {players.map((player) => (
              <tr key={playerIdentityKey(player)} className="border-t border-cs2-border/70 hover:bg-cs2-bg-hover">
                <td className="px-2 py-1.5">
                  <button type="button" onClick={() => onSelectPlayer?.(playerIdentityKey(player))} className="flex max-w-full items-center gap-1.5 text-left">
                    <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${teamDot(teamKey)}`} />
                    <span className="truncate text-[11px] font-bold text-cs2-text-primary">{player.name}</span>
                  </button>
                </td>
                <td className="px-1 text-right font-mono text-[9px] font-bold text-cs2-text-primary">{player.kills}</td>
                <td className="px-1 text-right font-mono text-[9px] text-cs2-text-secondary">{player.deaths}</td>
                <td className="px-1 text-right font-mono text-[9px] text-cs2-text-secondary">{player.assists}</td>
                <td className="px-1 text-right font-mono text-[9px] text-cs2-text-secondary">{Number(player.adr || 0).toFixed(0)}</td>
                <td className="px-1 text-right font-mono text-[9px] text-cs2-text-secondary">{Number(player.kast || 0).toFixed(0)}%</td>
                <td className="px-1 text-right font-mono text-[9px] text-cs2-text-secondary">{Number(player.hs_percent || 0).toFixed(0)}%</td>
                <td className="px-1 text-right font-mono text-[9px] text-cs2-text-secondary">{player.first_kills || 0}</td>
                <td className="px-1 text-right font-mono text-[9px] text-cs2-text-secondary">{player.awp_kills || 0}</td>
                <td className="px-2 text-right font-mono text-[9px] text-cs2-text-secondary">{player.utility_damage || 0}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function roundWinnerSide(round) {
  if (!round) return "";
  return round.winner_team_key === "a" ? round.team_a_side || "" : round.team_b_side || "";
}

function sortScoreboardPlayers(players) {
  return [...players].sort((a, b) => {
    const killsDiff = Number(b.kills || 0) - Number(a.kills || 0);
    if (killsDiff !== 0) return killsDiff;
    return Number(b.adr || 0) - Number(a.adr || 0);
  });
}

export function OverviewView({ data, onSelectPlayer, onOpenRound, onOpenReplayRound, onOpenHighlights }) {
  const t = useT();
  // t 随语言变化，确保概览文案按当前语言重建
  const overview = useMemo(() => buildOverviewModel(data), [data, t]);
  const [mobileScoreTeam, setMobileScoreTeam] = useState("a");
  const teamAName = data.team_a_name || "Team A";
  const teamBName = data.team_b_name || "Team B";
  const playersA = sortScoreboardPlayers(data.players.filter((player) => player.team_key === "a"));
  const playersB = sortScoreboardPlayers(data.players.filter((player) => player.team_key === "b"));
  const scoreA = Number(data.team_a_score || 0);
  const scoreB = Number(data.team_b_score || 0);
  const winnerA = scoreA > scoreB;
  const winnerB = scoreB > scoreA;
  const hasOpening = overview.opening?.hasData !== false;
  const hasObjective =
    overview.objective?.hasData !== false &&
    ((overview.objective?.teamA?.plants || 0) + (overview.objective?.teamB?.plants || 0) > 0 ||
      (overview.objective?.siteA || 0) + (overview.objective?.siteB || 0) > 0);
  const hasPlayerEvents = (overview.playerEvents || []).length > 0;
  const secondaryCount = [hasOpening, hasObjective, hasPlayerEvents].filter(Boolean).length;

  return (
    <div data-testid="analysis-overview-content" className="w-full space-y-3 pb-6">
      <MatchMainlineCard mainline={overview.mainline} />

      <section className="grid auto-rows-fr grid-cols-1 gap-2.5 lg:grid-cols-2 xl:grid-cols-12 xl:auto-rows-[210px]">
        <MatchTrendCard
          model={overview.trend}
          phaseMeta={overview.phaseMeta}
          teamAName={teamAName}
          teamBName={teamBName}
          className="lg:col-span-2 xl:col-span-5"
        />
        <SidePerformanceCard
          model={overview.sidePerformance}
          teamAName={teamAName}
          teamBName={teamBName}
          className="xl:col-span-4"
        />
        <EconomyInsightCard
          model={overview.economy}
          teamAName={teamAName}
          teamBName={teamBName}
          className="xl:col-span-3"
        />
      </section>

      {secondaryCount > 0 ? (
        <section
          className={`grid auto-rows-fr grid-cols-1 gap-2.5 md:grid-cols-2 xl:auto-rows-[176px] ${
            secondaryCount >= 3 ? "xl:grid-cols-3" : secondaryCount === 2 ? "xl:grid-cols-2" : "xl:grid-cols-1"
          }`}
        >
          <OpeningAdvantageCard model={overview.opening} teamAName={teamAName} teamBName={teamBName} />
          <BombObjectiveCard model={overview.objective} teamAName={teamAName} teamBName={teamBName} />
          <PlayerEventsCard
            events={overview.playerEvents}
            onSelectPlayer={onSelectPlayer}
            onOpenRound={onOpenRound}
            onOpenHighlights={onOpenHighlights}
          />
        </section>
      ) : null}

      <KeyRoundsTimeline
        rounds={overview.keyRounds}
        onOpenRound={onOpenRound}
        onOpenReplayRound={onOpenReplayRound}
      />

      <section data-testid="overview-full-scoreboard" className="rounded-[10px] border border-cs2-border bg-cs2-bg-card">
        <header className="flex items-center justify-between gap-3 border-b border-cs2-border px-3.5 py-2.5">
          <h2 className="text-[12px] font-bold text-cs2-text-primary">{t("analysis.ws.fullMatchStats")}</h2>
        </header>
        <div className="p-2.5">
          <div className="mb-2 flex gap-1 md:hidden">
            {[
              ["a", teamAName],
              ["b", teamBName],
            ].map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setMobileScoreTeam(key)}
                className={`rounded-md border px-2.5 py-1 text-[10px] font-semibold ${
                  mobileScoreTeam === key
                    ? "border-cs2-accent/50 bg-cs2-accent-soft text-cs2-accent"
                    : "border-cs2-border text-cs2-text-muted"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="grid gap-2.5 md:grid-cols-2">
            <div className={mobileScoreTeam === "a" ? "block" : "hidden md:block"}>
              <TeamScoreboard
                teamKey="a"
                name={teamAName}
                score={scoreA}
                players={playersA}
                onSelectPlayer={onSelectPlayer}
                winner={winnerA}
              />
            </div>
            <div className={mobileScoreTeam === "b" ? "block" : "hidden md:block"}>
              <TeamScoreboard
                teamKey="b"
                name={teamBName}
                score={scoreB}
                players={playersB}
                onSelectPlayer={onSelectPlayer}
                winner={winnerB}
              />
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

function FilterField({ label, value, onChange, children }) {
  return (
    <label className="analysis-filter-field">
      <span>{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)} className="analysis-filter-select">
        {children}
      </select>
    </label>
  );
}

function EventIcon({ type }) {
  if (type === "kill") return <Crosshair className="h-3.5 w-3.5" />;
  if (type === "grenade") return <Bomb className="h-3.5 w-3.5" />;
  if (type === "plant" || type === "explode") return <Zap className="h-3.5 w-3.5" />;
  return <ShieldCheck className="h-3.5 w-3.5" />;
}

function roundEventsForDisplay(round) {
  const start = Number(round?.start_tick ?? round?.freeze_end_tick ?? -Infinity);
  const end = Number(round?.end_tick ?? Infinity);
  const seen = new Set();
  const terminal = new Set();
  return (round?.events || []).filter((event) => {
    const tick = Number(event.tick || 0);
    if (Number.isFinite(start) && tick < start) return false;
    if (Number.isFinite(end) && tick > end) return false;
    if (["explode", "defuse"].includes(event.type)) {
      if (terminal.has(event.type)) return false;
      terminal.add(event.type);
    }
    const identity = [event.type, tick, event.actor, event.target, event.kind].join("|");
    if (seen.has(identity)) return false;
    seen.add(identity);
    return true;
  });
}

function RoundEventDetail({ event }) {
  const t = useT();
  if (event.type === "kill") {
    const weapon = event.weapon || t("analysis.ws.weaponFallback");
    return <span className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap"><KillfeedIconStrip event={{ ...event, is_headshot: Boolean(event.headshot) }} weaponName={weapon} weaponKey={weapon} /><span className="text-[10px] font-semibold text-sky-200">{event.target || t("analysis.ws.unknownPlayer")}</span></span>;
  }
  const text = event.type === "grenade" ? t("analysis.ws.eventThrow", { kind: event.kind || t("analysis.ws.grenadeFallback") })
    : event.type === "plant" ? t("analysis.ws.eventPlant", { site: event.site || "?" })
      : event.type === "defuse" ? t("analysis.ws.eventDefuse")
        : event.type === "bomb_pickup" ? t("analysis.ws.eventBombPickup")
          : event.type === "bomb_drop" ? t("analysis.ws.eventBombDrop")
            : event.type === "explode" ? t("analysis.ws.eventExplode")
              : t("analysis.ws.matchEvent");
  return <p className="mt-0.5 text-[10px] text-cs2-text-muted">{text}</p>;
}

function RoundEventBody({ event }) {
  const t = useT();
  const actor = event.actor || (event.type === "explode" ? "C4" : t("analysis.ws.matchEvent"));
  if (event.type === "kill") {
    return <div className="flex min-w-0 items-center gap-2 whitespace-nowrap"><p className="shrink-0 text-[11px] font-bold text-cs2-text-primary">{actor}</p><RoundEventDetail event={event} /></div>;
  }
  return <div><p className="text-[11px] font-bold text-cs2-text-primary">{actor}</p><RoundEventDetail event={event} /></div>;
}

export function RoundsView({ data, selectedRound, onSelectRound, onOpenReplayRound, contextRailTarget = null }) {
  const t = useT();
  const [winnerFilter, setWinnerFilter] = useState("all");
  const [sideFilter, setSideFilter] = useState("all");
  const [economyFilter, setEconomyFilter] = useState("all");
  const [siteFilter, setSiteFilter] = useState("all");
  const [openingFilter, setOpeningFilter] = useState("all");
  const [endFilter, setEndFilter] = useState("all");
  const [specialOnly, setSpecialOnly] = useState(false);
  const playerTeamByName = useMemo(() => new Map(data.players.map((player) => [String(player.name || "").toLowerCase(), player.team_key])), [data.players]);
  const finishType = (round) => {
    const reason = String(round.end_reason || "").toLowerCase();
    if (reason.includes("defus")) return "defuse";
    if (reason.includes("bombed") || reason.includes("explode") || reason.includes("targetbomb")) return "explode";
    return roundWinnerSide(round) === "CT" ? "ct_elimination" : "t_elimination";
  };
  const visibleRounds = data.rounds.filter((round) => {
    const openingKill = (round.events || []).find((event) => event.type === "kill");
    const openingTeam = playerTeamByName.get(String(openingKill?.actor || "").toLowerCase());
    return (winnerFilter === "all" || round.winner_team_key === winnerFilter)
      && (sideFilter === "all" || roundWinnerSide(round) === sideFilter)
      && (economyFilter === "all" || round.team_a_economy === economyFilter || round.team_b_economy === economyFilter)
      && (siteFilter === "all" || (siteFilter === "none" ? !round.site : round.site === siteFilter))
      && (openingFilter === "all" || openingTeam === openingFilter)
      && (endFilter === "all" || finishType(round) === endFilter)
      && (!specialOnly || (round.tags || []).some((tag) => /[2-5]K|翻盘|爆头|下包|残局/.test(tag)));
  });
  const round = visibleRounds.find((item) => Number(item.round_number) === Number(selectedRound)) || visibleRounds[0] || null;
  if (!data.rounds.length) return <Panel title={t("analysis.ws.roundList")}><div className="p-12 text-center text-[11px] text-cs2-text-muted">{t("analysis.ws.noRounds")}</div></Panel>;
  const displayEvents = round ? roundEventsForDisplay(round) : [];
  const filterFields = (
    <>
      <FilterField label={t("analysis.ws.filterWinner")} value={winnerFilter} onChange={setWinnerFilter}>
        <option value="all">{t("analysis.ws.allWinners")}</option><option value="a">{t("analysis.ws.teamWins", { team: data.team_a_name })}</option><option value="b">{t("analysis.ws.teamWins", { team: data.team_b_name })}</option>
      </FilterField>
      <FilterField label={t("analysis.ws.filterSide")} value={sideFilter} onChange={setSideFilter}>
        <option value="all">{t("analysis.ws.allSides")}</option><option value="CT">{t("analysis.ws.ctWins")}</option><option value="T">{t("analysis.ws.tWins")}</option>
      </FilterField>
      <FilterField label={t("analysis.ws.filterEconomy")} value={economyFilter} onChange={setEconomyFilter}>
        <option value="all">{t("analysis.ws.allEconomy")}</option><option value="pistol">{t("analysis.ws.ecoPistol")}</option><option value="eco">{t("analysis.ws.ecoPureEco")}</option><option value="force">{t("analysis.ws.ecoForce")}</option><option value="semi">{t("analysis.ws.ecoSemi")}</option><option value="full">{t("analysis.ws.ecoFullBuy")}</option>
      </FilterField>
      <FilterField label={t("analysis.ws.filterSite")} value={siteFilter} onChange={setSiteFilter}>
        <option value="all">{t("analysis.ws.allSites")}</option><option value="A">{t("analysis.ws.siteOption", { site: "A" })}</option><option value="B">{t("analysis.ws.siteOption", { site: "B" })}</option><option value="none">{t("analysis.ws.noPlant")}</option>
      </FilterField>
      <FilterField label={t("analysis.ws.filterOpening")} value={openingFilter} onChange={setOpeningFilter}>
        <option value="all">{t("analysis.ws.anyOpening")}</option><option value="a">{data.team_a_name}</option><option value="b">{data.team_b_name}</option>
      </FilterField>
      <FilterField label={t("analysis.ws.filterEnd")} value={endFilter} onChange={setEndFilter}>
        <option value="all">{t("analysis.ws.allEnds")}</option><option value="ct_elimination">{t("analysis.ws.endCtElim")}</option><option value="defuse">{t("analysis.ws.endDefuse")}</option><option value="t_elimination">{t("analysis.ws.endTElim")}</option><option value="explode">{t("analysis.ws.endExplode")}</option>
      </FilterField>
    </>
  );
  const filters = contextRailTarget ? (
    <section className="analysis-side-section">
      <header className="flex items-center justify-between gap-2 border-b border-cs2-border-subtle px-3 py-2">
        <span className="inline-flex items-center gap-1.5 text-[9px] font-black uppercase tracking-[0.16em] text-cs2-text-muted"><Filter className="h-3 w-3" />{t("analysis.ws.roundFilters")}</span>
        <span className="font-mono text-[9px] text-cs2-text-muted">{visibleRounds.length}/{data.rounds.length}</span>
      </header>
      <div className="analysis-rail-filter-grid grid grid-cols-2 gap-2 p-3">
        {filterFields}
        <button type="button" data-active={specialOnly ? "true" : "false"} className="analysis-filter-toggle col-span-2" onClick={() => setSpecialOnly((value) => !value)}>{t("analysis.ws.keyRoundsOnly")}</button>
      </div>
    </section>
  ) : (
    <Panel>
      <div className="analysis-filterbar">
        <div className="flex h-7 items-center gap-1.5 self-end text-[10px] font-bold text-cs2-text-secondary"><Filter className="h-3.5 w-3.5" />{t("analysis.ws.roundFilters")}</div>
        {filterFields}
        <button type="button" data-active={specialOnly ? "true" : "false"} className="analysis-filter-toggle self-end" onClick={() => setSpecialOnly((value) => !value)}>{t("analysis.ws.keyRoundsOnly")}</button>
        <span className="ml-auto self-center font-mono text-[9px] text-cs2-text-muted">{t("analysis.ws.matchCount", { n: visibleRounds.length, total: data.rounds.length })}</span>
      </div>
    </Panel>
  );
  return (
    <div className="space-y-3">
      {contextRailTarget ? createPortal(filters, contextRailTarget) : filters}
      {round ? (
        <div className="grid h-[calc(100vh-106px)] min-h-[500px] gap-3 lg:grid-cols-[minmax(300px,0.82fr)_minmax(0,1.5fr)]">
          <Panel title={t("analysis.ws.roundList")} eyebrow="Round explorer" className="flex min-h-0 flex-col overflow-hidden">
            <div className="custom-scrollbar min-h-0 flex-1 divide-y divide-cs2-border-subtle overflow-y-auto">
              {visibleRounds.map((item) => {
                const side = roundWinnerSide(item);
                const active = Number(round.round_number) === Number(item.round_number);
                return (
                  <button key={item.round_number} type="button" onClick={() => onSelectRound(item.round_number)} className={`flex w-full items-center gap-3 border-l-2 px-3 py-2.5 text-left transition-colors ${active ? "border-cs2-accent bg-cs2-accent-soft/55" : "border-transparent hover:bg-cs2-bg-hover"}`}>
                    <span className={`w-7 shrink-0 font-mono text-[10px] font-bold ${item.winner_team_key === "a" ? "text-sky-400" : "text-amber-400"}`}>R{item.round_number}</span>
                    <div className="min-w-0 flex-1"><p className="truncate text-[11px] font-semibold text-cs2-text-primary">{item.headline}</p><p className="mt-0.5 text-[9px] text-cs2-text-muted">{scoreText(item)} · {item.site ? t("analysis.ws.siteZone", { site: item.site }) : ""}{durationText(item.duration_seconds)}</p></div>
                    <span className={`shrink-0 text-[8px] font-black ${side === "CT" ? "text-sky-300" : "text-amber-300"}`}>{t("analysis.ws.sideWins", { side: side || "—" })}</span>
                  </button>
                );
              })}
            </div>
          </Panel>
          <Panel title={t("analysis.ws.roundTitle", { n: round.round_number, headline: round.headline })} eyebrow={t("analysis.ws.teamWon", { team: round.winner_team_key === "a" ? data.team_a_name : data.team_b_name })} className="flex min-h-0 flex-col overflow-hidden" action={<Button size="sm" onClick={() => onOpenReplayRound(round.round_number)}><MapPin className="h-3 w-3" />{t("analysis.ws.openRoundIn2d")}</Button>}>
            <div className="custom-scrollbar min-h-0 flex-1 overflow-y-auto p-4">
              <div className="mb-5 grid grid-cols-3 items-center gap-3 border-b border-cs2-border-subtle pb-4 text-center">
                <div><p className="text-[10px] font-bold text-sky-400">{data.team_a_name}</p><p className="mt-1 text-[10px] text-cs2-text-muted">{economyLabel(round.team_a_economy, t)} · {money(round.team_a_equipment_value)}</p></div>
                <div><p className="font-mono text-2xl font-black text-cs2-text-primary">{scoreText(round)}</p><p className="text-[9px] uppercase tracking-wider text-cs2-text-muted">Round score</p></div>
                <div><p className="text-[10px] font-bold text-amber-400">{data.team_b_name}</p><p className="mt-1 text-[10px] text-cs2-text-muted">{economyLabel(round.team_b_economy, t)} · {money(round.team_b_equipment_value)}</p></div>
              </div>
              <div className="relative ml-2 border-l border-cs2-border pl-5">{displayEvents.map((event, index) => <div key={`${event.type}-${event.tick}-${index}`} className="relative pb-5 last:pb-0"><span className={`absolute -left-[27px] top-0.5 h-3 w-3 rounded-full border-2 border-cs2-bg-card ${event.type === "kill" ? "bg-cs2-accent" : "bg-cs2-text-muted"}`} /><div className="flex items-start gap-3"><span className="w-9 shrink-0 font-mono text-[9px] text-cs2-text-muted">{event.time_text || "--:--"}</span><span className={event.type === "kill" ? "text-cs2-accent" : "text-cs2-text-secondary"}><EventIcon type={event.type} /></span><RoundEventBody event={event} /></div></div>)}{!displayEvents.length && <p className="py-8 text-center text-[10px] text-cs2-text-muted">{t("analysis.ws.noRoundEvents")}</p>}</div>
            </div>
          </Panel>
        </div>
      ) : (
        <Panel title={t("analysis.ws.roundList")}><div className="p-12 text-center text-[11px] text-cs2-text-muted">{t("analysis.ws.noFilteredRounds")}</div></Panel>
      )}
    </div>
  );
}

function StatBar({ label, value, display, max = 100 }) {
  const width = Math.max(0, Math.min(100, Number(value || 0) / Math.max(1, max) * 100));
  return <div className="grid grid-cols-[104px_minmax(100px,1fr)_52px] items-center gap-2"><span className="text-[10px] text-cs2-text-secondary">{label}</span><div data-testid="analysis-stat-track" className="h-1.5 overflow-hidden rounded-full bg-cs2-border-subtle"><div className="h-full rounded-full bg-gradient-to-r from-emerald-400 to-sky-400" style={{ width: `${width}%` }} /></div><span className="text-right font-mono text-[10px] font-bold text-cs2-text-primary">{display ?? value}</span></div>;
}

function StatGroup({ title, rows }) {
  return <section className="border-l-2 border-cs2-border-subtle bg-cs2-bg-input/20 p-3"><h3 className="mb-3 text-[9px] font-black uppercase tracking-wider text-cs2-text-secondary">{title}</h3><div className="space-y-2.5">{rows.map((row) => <StatBar key={row.label} {...row} />)}</div></section>;
}

export function PlayersView({ data, selectedPlayer, onBackToOverview }) {
  const t = useT();
  const player = data.players.find((item) => playerIdentityKey(item) === selectedPlayer) || data.players[0];
  if (!player) return <Panel title={t("analysis.ws.allPlayers")}><div className="p-12 text-center text-[11px] text-cs2-text-muted">{t("analysis.ws.noPlayers")}</div></Panel>;
  const groups = [
    { title: "Combat", rows: [{ label: t("analysis.ws.statKills"), value: player.kills, max: 40 }, { label: t("analysis.ws.statDeaths"), value: player.deaths, max: 40 }, { label: t("analysis.ws.statAssists"), value: player.assists, max: 20 }, { label: "KPR", value: player.kpr, display: Number(player.kpr || 0).toFixed(2), max: 1.4 }, { label: "DPR", value: player.dpr, display: Number(player.dpr || 0).toFixed(2), max: 1.2 }, { label: "ADR", value: player.adr, display: Number(player.adr || 0).toFixed(1), max: 130 }, { label: "HS%", value: player.hs_percent, display: `${Number(player.hs_percent || 0).toFixed(0)}%` }, { label: "KAST", value: player.kast, display: `${Number(player.kast || 0).toFixed(0)}%` }, { label: t("analysis.ws.statSurvival"), value: player.survival_rate, display: `${Number(player.survival_rate || 0).toFixed(0)}%` }, { label: t("analysis.ws.stat2k"), value: player.two_kill_rounds, max: 8 }, { label: t("analysis.ws.stat3k"), value: player.three_kill_rounds, max: 5 }, { label: t("analysis.ws.stat4k"), value: player.four_kill_rounds, max: 3 }, { label: t("analysis.ws.stat5k"), value: player.five_kill_rounds, max: 1 }] },
    { title: "Opening / Trade", rows: [{ label: t("analysis.ws.statFirstKills"), value: player.first_kills, max: 10 }, { label: t("analysis.ws.statFirstDeaths"), value: player.first_deaths, max: 10 }, { label: t("analysis.ws.statOpeningDuel"), value: player.opening_duel_win_rate, display: `${Number(player.opening_duel_win_rate || 0).toFixed(0)}%` }, { label: t("analysis.ws.statTradeKills"), value: player.trade_kills, max: 10 }, { label: t("analysis.ws.statTradeDeaths"), value: player.trade_deaths, max: 10 }, { label: t("analysis.ws.statTradeRate"), value: player.trade_kill_rate, display: `${Number(player.trade_kill_rate || 0).toFixed(0)}%` }] },
    { title: "Clutch / Weapon", rows: [{ label: t("analysis.ws.statClutchAttempts"), value: player.clutch_attempts || 0, max: 8 }, { label: t("analysis.ws.statClutchWins"), value: player.clutch_wins || 0, max: 5 }, { label: t("analysis.ws.statAwpKills"), value: player.awp_kills, max: 20 }, { label: t("analysis.ws.statHeadshots"), value: player.headshots, max: 30 }, { label: t("analysis.ws.statMultiKill"), value: Number(player.two_kill_rounds || 0) + Number(player.three_kill_rounds || 0) + Number(player.four_kill_rounds || 0) + Number(player.five_kill_rounds || 0), max: 12 }] },
    { title: "Utility / Economy", rows: [{ label: t("analysis.ws.statUtilDamage"), value: player.utility_damage, max: 500 }, { label: t("analysis.ws.statUtilPerRound"), value: player.utility_damage_per_round, display: Number(player.utility_damage_per_round || 0).toFixed(1), max: 25 }, { label: t("analysis.ws.statAvgEquip"), value: player.average_equipment_value, display: money(player.average_equipment_value), max: 6000 }] },
  ];
  return (
    <div className="space-y-4">
      <Panel><div className="flex flex-wrap items-center gap-4 p-5"><div className={`flex h-14 w-14 items-center justify-center rounded-md text-xl font-black ${player.team_key === "a" ? "bg-sky-500/15 text-sky-400" : "bg-amber-500/15 text-amber-400"}`}>{player.name.slice(0, 1).toUpperCase()}</div><div className="min-w-0 flex-1"><div className="flex items-baseline gap-2"><h2 className="text-xl font-black text-cs2-text-primary">{player.name}</h2><span className="text-[9px] font-bold uppercase tracking-wider text-cs2-accent">{player.team_key === "a" ? data.team_a_name : data.team_b_name}</span></div><p className="mt-1 text-[10px] text-cs2-text-muted">{t("analysis.ws.playerSubtitle", { n: data.rounds.length })}</p></div><Button variant="secondary" onClick={onBackToOverview}><ArrowLeft className="h-3.5 w-3.5" />{t("analysis.ws.backToOverview")}</Button></div></Panel>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><MetricCard icon={Swords} label="K / D / A" value={`${player.kills} / ${player.deaths} / ${player.assists}`} detail={`${Number(player.kd || 0).toFixed(2)} K/D`} tone="blue" /><MetricCard icon={Activity} label="ADR" value={Number(player.adr || 0).toFixed(1)} detail={t("analysis.ws.totalDamage", { n: Math.round(Number(player.adr || 0) * Math.max(1, data.rounds.length)) })} /><MetricCard icon={ShieldCheck} label="KAST" value={`${Number(player.kast || 0).toFixed(0)}%`} detail={t("analysis.ws.tradeKillsDetail", { n: player.trade_kills || 0 })} tone="green" /><MetricCard icon={Gauge} label={t("analysis.ws.hsRate")} value={`${Number(player.hs_percent || 0).toFixed(0)}%`} detail={t("analysis.ws.fkAwpDetail", { fk: player.first_kills || 0, awp: player.awp_kills || 0 })} tone="violet" /></div>
      <Panel title={t("analysis.ws.detailedStats")} eyebrow={t("analysis.ws.detailedStatsEyebrow")}><div className="grid gap-3 p-4 xl:grid-cols-2">{groups.map((group) => <StatGroup key={group.title} {...group} />)}</div></Panel>
    </div>
  );
}

function EconomyChart({ rounds, teamAName, teamBName }) {
  const t = useT();
  const width = 1100;
  const height = 300;
  const pad = { left: 60, right: 20, top: 22, bottom: 42 };
  const values = rounds.flatMap((round) => [Number(round.team_a_equipment_value || 0), Number(round.team_b_equipment_value || 0)]);
  const maxValue = Math.max(10000, ...values, 1);
  const innerW = width - pad.left - pad.right;
  const innerH = height - pad.top - pad.bottom;
  const x = (index) => pad.left + (rounds.length <= 1 ? innerW / 2 : index / (rounds.length - 1) * innerW);
  const y = (value) => pad.top + innerH - Number(value || 0) / maxValue * innerH;
  const path = (key) => rounds.map((round, index) => `${index ? "L" : "M"}${x(index)},${y(round[key])}`).join(" ");
  const bandColors = {
    pistol: "var(--cs2-amber-surface)",
    eco: "var(--cs2-bg-input)",
    semi: "var(--cs2-cyan-surface)",
    force: "var(--cs2-rose-surface)",
    full: "var(--cs2-emerald-surface)",
  };
  const bandW = innerW / Math.max(1, rounds.length);
  return (
    <div className="overflow-x-auto"><svg viewBox={`0 0 ${width} ${height}`} className="min-w-[760px] w-full"><line x1={pad.left} y1={pad.top} x2={pad.left} y2={height - pad.bottom} stroke="var(--cs2-border)" /><line x1={pad.left} y1={height - pad.bottom} x2={width - pad.right} y2={height - pad.bottom} stroke="var(--cs2-border)" />{[0, 0.5, 1].map((ratio) => <g key={ratio}><line x1={pad.left} y1={pad.top + innerH * ratio} x2={width - pad.right} y2={pad.top + innerH * ratio} stroke="var(--cs2-border-subtle)" /><text x={pad.left - 10} y={pad.top + innerH * ratio + 4} textAnchor="end" fill="var(--cs2-text-muted)" fontSize="11">{money(maxValue * (1 - ratio))}</text></g>)}{rounds.map((round, index) => <g key={round.round_number}><rect x={pad.left + index * bandW} y={pad.top} width={bandW - 1} height={innerH} fill={bandColors[round.team_a_economy] || bandColors.semi} opacity=".62" /><text x={pad.left + index * bandW + bandW / 2} y={height - 18} textAnchor="middle" fill="var(--cs2-text-muted)" fontSize="10">R{round.round_number}</text></g>)}<path d={path("team_a_equipment_value")} fill="none" stroke="var(--cs2-team-blue)" strokeWidth="4" strokeLinejoin="round" /> <path d={path("team_b_equipment_value")} fill="none" stroke="var(--cs2-team-amber)" strokeWidth="4" strokeLinejoin="round" />{rounds.map((round, index) => <g key={`points-${round.round_number}`}><circle cx={x(index)} cy={y(round.team_a_equipment_value)} r="3.5" fill="var(--cs2-team-blue)" /><circle cx={x(index)} cy={y(round.team_b_equipment_value)} r="3.5" fill="var(--cs2-team-amber)" /></g>)}</svg><div className="flex items-center gap-5 px-2 text-[9px]"><span className="text-sky-400">━ {teamAName}</span><span className="text-amber-400">━ {teamBName}</span><span className="ml-auto text-cs2-text-muted">{t("analysis.ws.economyLegend")}</span></div></div>
  );
}

export function EconomyView({ data, onOpenRound }) {
  const t = useT();
  return (
    <Panel title={t("analysis.ws.economyTitle")} eyebrow={t("analysis.ws.economyEyebrow")}><div className="p-4"><EconomyChart rounds={data.rounds} teamAName={data.team_a_name} teamBName={data.team_b_name} /><div className="mt-4 grid border-l border-t border-cs2-border-subtle sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-6">{data.rounds.map((round) => <button key={round.round_number} type="button" onClick={() => onOpenRound(round.round_number)} className="border-b border-r border-cs2-border-subtle bg-cs2-bg-input/15 p-2.5 text-left transition-colors hover:bg-cs2-bg-hover"><div className="flex items-center justify-between gap-2"><span className="font-mono text-[9px] font-bold text-cs2-text-primary">R{round.round_number} {Number(round.team_a_score_after || 0)}:{Number(round.team_b_score_after || 0)}</span><span className={`shrink-0 text-[8px] font-bold ${round.winner_team_key === "a" ? "text-sky-400" : "text-emerald-400"}`}>{t("analysis.ws.teamWins", { team: round.winner_team_key === "a" ? data.team_a_name : data.team_b_name })}</span></div><p className="mt-1 text-[8px] text-sky-400">{data.team_a_name}: {economyLabel(round.team_a_economy, t)} · {money(round.team_a_equipment_value)}</p><p className="mt-0.5 text-[8px] text-emerald-400">{data.team_b_name}: {economyLabel(round.team_b_economy, t)} · {money(round.team_b_equipment_value)}</p></button>)}</div></div></Panel>
  );
}
