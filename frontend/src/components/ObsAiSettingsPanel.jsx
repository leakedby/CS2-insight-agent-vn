import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  ChevronRight,
  FileCheck2,
  Loader2,
  LockKeyhole,
  Monitor,
  Power,
  RadioTower,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  WandSparkles,
  X,
} from "lucide-react";
import {
  applyObsTuningPlan,
  bootstrapObsTuningEnvironment,
  createObsTuningPlan,
  discoverObsTuningEnvironment,
  recommendObsTuningGoal,
  restoreObsTuningBackup,
} from "../api/obsTuning";
import { useT } from "../i18n/useT.js";
import {
  GoalScreen,
  ScreenNav,
} from "../pages/ObsAiTuningPreviewPage";

const BOOTSTRAP_STATUS_TEXT = {
  connected: "settings.obsAi.status.connected",
  install_not_found: "settings.obsAi.status.install_not_found",
  needs_password: "settings.obsAi.status.needs_password",
  invalid_password: "settings.obsAi.status.invalid_password",
  needs_safe_restart: "settings.obsAi.status.needs_safe_restart",
  needs_websocket_enable: "settings.obsAi.status.needs_websocket_enable",
  needs_launch: "settings.obsAi.status.needs_launch",
  launch_failed: "settings.obsAi.status.launch_failed",
  connection_failed: "settings.obsAi.status.connection_failed",
  websocket_config_failed: "settings.obsAi.status.websocket_config_failed",
  websocket_config_unavailable: "settings.obsAi.status.websocket_config_unavailable",
};

const BOOTSTRAP_STEP_TEXT = {
  detect_install: "settings.obsAi.step.detect_install",
  check_process: "settings.obsAi.step.check_process",
  inspect_websocket: "settings.obsAi.step.inspect_websocket",
  enable_websocket: "settings.obsAi.step.enable_websocket",
  launch_obs: "settings.obsAi.step.launch_obs",
  connect_websocket: "settings.obsAi.step.connect_websocket",
};

const BOOTSTRAP_EVENT_STATUS_TEXT = {
  ok: "settings.obsAi.event.ok",
  warning: "settings.obsAi.event.warning",
  pending: "settings.obsAi.event.pending",
  blocked: "settings.obsAi.event.blocked",
  failed: "settings.obsAi.event.failed",
  skipped: "settings.obsAi.event.skipped",
};

function resolutionKey(width, height, fallback = "current") {
  if (Number(width) === 1920 && Number(height) === 1440) return "four-three";
  if (Number(width) === 1920 && Number(height) === 1080) return "full-hd";
  return fallback;
}

function selectedOutputDimensions(goal, discovery) {
  if (goal.resolution === "four-three") return { width: 1920, height: 1440 };
  if (goal.resolution === "full-hd") return { width: 1920, height: 1080 };
  const current = discovery?.obs?.video || {};
  return {
    width: Number(current.output_width || current.base_width || 2560),
    height: Number(current.output_height || current.base_height || 1440),
  };
}

function buildFallbackRecommendation(goal, t) {
  const dimensions = goal.resolution === "four-three"
    ? [1920, 1440]
    : goal.resolution === "full-hd"
      ? [1920, 1080]
      : [2560, 1440];
  const throughput = Math.round((dimensions[0] * dimensions[1] * goal.fps) / 1_000_000);
  const encoderLoad = Math.min(99, Math.max(8, Math.round(throughput / 20)));
  const renderLoad = Math.min(99, Math.max(10, Math.round(throughput / 22)));
  const score = Math.max(24, Math.min(96, 100 - Math.max(0, encoderLoad - 60) - Math.max(0, renderLoad - 60)));
  const recommendedFps = goal.fps > 240 ? 240 : goal.fps;
  const recommendedResolution = goal.fps >= 480 && goal.resolution === "current" ? "full-hd" : goal.resolution;
  const saferResolution = recommendedResolution === "full-hd" ? "1920 × 1080" : `${dimensions[0]} × ${dimensions[1]}`;
  const tone = score >= 85 ? "success" : score >= 68 ? "accent" : score >= 48 ? "warning" : "danger";
  return {
    score,
    label: score >= 85 ? t("settings.obsAi.rec.recommended") : score >= 68 ? t("settings.obsAi.rec.worthTrying") : score >= 48 ? t("settings.obsAi.rec.experimental") : t("settings.obsAi.rec.notRecommended"),
    verdict: score >= 68 ? t("settings.obsAi.rec.verdictOk") : t("settings.obsAi.rec.verdictRisk"),
    tone,
    encoderLoad,
    renderLoad,
    headroom: Math.max(0, 100 - Math.max(encoderLoad, renderLoad)),
    megapixelsPerSecond: throughput,
    risks: [t("settings.obsAi.rec.risk")],
    bottleneck: encoderLoad >= renderLoad ? t("settings.obsAi.rec.bottleneckEncoder") : t("settings.obsAi.rec.bottleneckRender"),
    recommendedFps,
    recommendedResolution,
    saferResolution,
    fileEstimate: t("settings.obsAi.rec.fileEstimatePending"),
  };
}

function toWorkspaceRecommendation(raw, fallback, t) {
  if (!raw) return fallback;
  const safer = raw.safer_start || {};
  const target = raw.target || {};
  const loads = raw.loads || {};
  const low = raw.file_size?.low_gb_per_10_min;
  const high = raw.file_size?.high_gb_per_10_min;
  const tone = raw.level === "recommended"
    ? "success"
    : raw.level === "not_recommended"
      ? "danger"
      : raw.level === "experimental"
        ? "warning"
        : "accent";
  return {
    ...fallback,
    ...raw,
    tone,
    renderLoad: loads.render_percent ?? fallback.renderLoad,
    encoderLoad: loads.encoder_percent ?? fallback.encoderLoad,
    headroom: loads.headroom_percent ?? fallback.headroom,
    megapixelsPerSecond: loads.megapixels_per_second ?? fallback.megapixelsPerSecond,
    recommendedFps: safer.fps_num ?? target.fps_num ?? fallback.recommendedFps,
    recommendedResolution: resolutionKey(safer.width, safer.height, fallback.recommendedResolution),
    saferResolution: safer.width && safer.height ? `${safer.width} × ${safer.height}` : fallback.saferResolution,
    fileEstimate: low != null && high != null ? t("settings.obsAi.rec.fileEstimate", { low, high }) : fallback.fileEstimate,
    risks: raw.risks?.length ? raw.risks : fallback.risks,
  };
}

function ConnectionStatus({ icon: Icon, label, value, ok, loading = false }) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-cs2-border/75 bg-cs2-bg-input/45 p-3">
      <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${loading ? "bg-cs2-accent/10 text-cs2-accent" : ok ? "bg-emerald-400/10 text-emerald-300" : "bg-amber-400/10 text-amber-300"}`}>
        {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Icon className="h-4 w-4" />}
      </span>
      <div className="min-w-0">
        <div className="text-[9px] font-bold uppercase tracking-[0.12em] text-cs2-text-muted">{label}</div>
        <div className="mt-0.5 truncate text-[11px] font-semibold text-cs2-text-primary">{value}</div>
      </div>
    </div>
  );
}

function ConnectionDialog({
  autoPrepare,
  bootstrapLoading,
  bootstrapPassword,
  bootstrapResult,
  discovery,
  discoveryLoading,
  errorMessage,
  ffmpegReady,
  onAutoPrepareChange,
  onBootstrap,
  onClose,
  onPasswordChange,
  onRefresh,
}) {
  const t = useT();
  const passwordNeeded = ["needs_password", "invalid_password"].includes(bootstrapResult?.status);
  const installDetected = Boolean(discovery?.obs?.install_detected);
  const connected = discovery ? Boolean(discovery?.obs?.connected) : Boolean(bootstrapResult?.ok);
  const primaryLabel = bootstrapResult?.status === "needs_safe_restart"
    ? t("settings.obsAi.dlg.retryAfterClose")
    : passwordNeeded
      ? t("settings.obsAi.dlg.connectWithPassword")
      : t("settings.obsAi.dlg.autoConnect");

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="obs-connection-title">
      <div className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-cs2-accent/35 bg-cs2-bg-card shadow-2xl shadow-black/50">
        <div className="border-b border-cs2-border bg-[radial-gradient(circle_at_top_right,rgba(224,127,10,0.18),transparent_48%)] p-5">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-start gap-3">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-cs2-accent/30 bg-cs2-accent/10 text-cs2-accent">
                {discoveryLoading ? <Loader2 className="h-5 w-5 animate-spin" /> : <RadioTower className="h-5 w-5" />}
              </span>
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h2 id="obs-connection-title" className="text-base font-bold text-cs2-text-primary">
                    {discoveryLoading ? t("settings.obsAi.checking") : connected ? t("settings.obsAi.dlg.ready") : t("settings.obsAi.dlg.notConnected")}
                  </h2>
                  {!discoveryLoading && !connected && <span className="rounded-full border border-amber-400/30 bg-amber-400/10 px-2 py-0.5 text-[9px] font-bold text-amber-300">{t("settings.obsAi.dlg.connectToContinue")}</span>}
                </div>
                <p className="mt-1 text-[11px] leading-relaxed text-cs2-text-secondary">
                  {t("settings.obsAi.dlg.intro")}
                </p>
              </div>
            </div>
            {!discoveryLoading && !bootstrapLoading && (
              <button type="button" onClick={onClose} aria-label={t("settings.obsAi.dlg.close")} className="rounded-lg p-1.5 text-cs2-text-muted hover:bg-cs2-bg-hover hover:text-cs2-text-primary">
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>

        <div className="space-y-4 p-5">
          <div className="grid gap-2 sm:grid-cols-3">
            <ConnectionStatus icon={Monitor} label={t("settings.obsAi.dlg.program")} loading={discoveryLoading} ok={installDetected} value={discoveryLoading ? t("settings.obsAi.dlg.searching") : installDetected ? t("settings.obsAi.dlg.found") : t("settings.obsAi.dlg.notFound")} />
            <ConnectionStatus icon={Power} label={t("settings.obsAi.dlg.isOpen")} loading={bootstrapLoading} ok={connected} value={bootstrapLoading ? t("settings.obsAi.dlg.opening") : connected ? t("settings.obsAi.dlg.opened") : t("settings.obsAi.dlg.waiting")} />
            <ConnectionStatus icon={RadioTower} label={t("settings.obsAi.dlg.connStatus")} loading={discoveryLoading || bootstrapLoading} ok={connected} value={connected ? t("settings.obsAi.dlg.connected") : t("settings.obsAi.dlg.notYet")} />
          </div>

          {!discoveryLoading && (
            <div className="grid gap-3 md:grid-cols-2">
              <div className="rounded-xl border border-cs2-border bg-cs2-bg-input/30 p-4">
                <div className="flex items-center gap-2 text-[11px] font-bold text-cs2-text-primary"><WandSparkles className="h-4 w-4 text-cs2-accent" />{t("settings.obsAi.dlg.weHandle")}</div>
                <ol className="mt-3 space-y-2 text-[10px] leading-relaxed text-cs2-text-secondary">
                  <li className="flex gap-2"><span className="font-mono text-cs2-accent">01</span><span>{t("settings.obsAi.dlg.do1")}</span></li>
                  <li className="flex gap-2"><span className="font-mono text-cs2-accent">02</span><span>{t("settings.obsAi.dlg.do2")}</span></li>
                  <li className="flex gap-2"><span className="font-mono text-cs2-accent">03</span><span>{t("settings.obsAi.dlg.do3")}</span></li>
                </ol>
              </div>
              <div className="rounded-xl border border-emerald-400/20 bg-emerald-400/[0.04] p-4">
                <div className="flex items-center gap-2 text-[11px] font-bold text-cs2-text-success"><LockKeyhole className="h-4 w-4" />{t("settings.obsAi.dlg.wontTouch")}</div>
                <ul className="mt-3 space-y-2 text-[10px] leading-relaxed text-cs2-text-secondary">
                  {[t("settings.obsAi.dlg.keep1"), t("settings.obsAi.dlg.keep2"), t("settings.obsAi.dlg.keep3"), t("settings.obsAi.dlg.keep4")].map((item) => (
                    <li key={item} className="flex gap-2"><CheckCircle2 className="mt-0.5 h-3 w-3 shrink-0 text-cs2-text-success" />{item}</li>
                  ))}
                </ul>
              </div>
            </div>
          )}

          {bootstrapResult && !bootstrapResult.ok && (
            <div className="rounded-xl border border-amber-400/30 bg-amber-400/[0.06] p-3.5">
              <div className="flex items-start gap-2.5">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" />
                <div className="min-w-0 flex-1">
                  <div className="text-[11px] font-bold text-amber-200">{t("settings.obsAi.dlg.oneMoreStep")}</div>
                  <p className="mt-1 text-[10px] leading-relaxed text-cs2-text-secondary">{BOOTSTRAP_STATUS_TEXT[bootstrapResult.status] ? t(BOOTSTRAP_STATUS_TEXT[bootstrapResult.status]) : t("settings.obsAi.autoConnectIncomplete")}</p>
                  {(bootstrapResult.events || []).length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {bootstrapResult.events.map((event) => (
                        <span key={`${event.step}-${event.status}`} title={event.message} className="rounded-full border border-cs2-border bg-black/10 px-2 py-1 text-[9px] text-cs2-text-secondary">
                          {t(BOOTSTRAP_STEP_TEXT[event.step] || "settings.obsAi.stepFallback")} · {t(BOOTSTRAP_EVENT_STATUS_TEXT[event.status] || "settings.obsAi.eventFallback")}
                        </span>
                      ))}
                    </div>
                  )}
                  {bootstrapResult.backup_path && <p className="mt-2 break-all font-mono text-[9px] text-cs2-text-muted">{t("settings.obsAi.dlg.backup", { path: bootstrapResult.backup_path })}</p>}
                </div>
              </div>
            </div>
          )}

          {passwordNeeded && (
            <div>
              <label htmlFor="obs-agent-password" className="text-[10px] font-bold text-cs2-text-primary">{t("settings.obsAi.dlg.password")}</label>
              <input id="obs-agent-password" type="password" value={bootstrapPassword} onChange={(event) => onPasswordChange(event.target.value)} placeholder={t("settings.obsAi.dlg.passwordPlaceholder")} className="mt-1.5 w-full rounded-xl border border-cs2-border bg-cs2-bg-input px-3 py-2.5 text-[11px] text-cs2-text-primary outline-none focus:border-cs2-accent/60" />
            </div>
          )}

          {errorMessage && <div className="rounded-xl border border-rose-400/30 bg-rose-400/[0.05] px-3 py-2.5 text-[10px] text-cs2-rose-on-surface">{errorMessage}</div>}

          {!discoveryLoading && (
            <label className="flex cursor-pointer items-start gap-2.5 rounded-xl border border-cs2-border/70 bg-cs2-bg-input/25 px-3 py-2.5 text-[10px] text-cs2-text-secondary">
              <input type="checkbox" checked={autoPrepare} onChange={(event) => onAutoPrepareChange?.(event.target.checked)} className="mt-0.5 h-3.5 w-3.5 accent-cs2-accent" />
              <span><strong className="font-semibold text-cs2-text-primary">{t("settings.obsAi.dlg.autoPrepare")}</strong><span className="mt-0.5 block text-[9px] text-cs2-text-muted">{t("settings.obsAi.dlg.autoPrepareHint")}</span></span>
            </label>
          )}

          <div className="flex flex-col-reverse gap-2 border-t border-cs2-border/70 pt-4 sm:flex-row sm:justify-end">
            <button type="button" onClick={onClose} disabled={discoveryLoading || bootstrapLoading} className="rounded-xl border border-cs2-border bg-cs2-bg-input px-4 py-2.5 text-[11px] font-semibold text-cs2-text-secondary disabled:opacity-40">{t("settings.obsAi.dlg.later")}</button>
            <button type="button" onClick={onRefresh} disabled={discoveryLoading || bootstrapLoading} className="inline-flex items-center justify-center gap-2 rounded-xl border border-cs2-border bg-cs2-bg-input px-4 py-2.5 text-[11px] font-semibold text-cs2-text-secondary hover:border-cs2-accent/35 disabled:opacity-40"><RefreshCw className={`h-3.5 w-3.5 ${discoveryLoading ? "animate-spin" : ""}`} />{t("settings.obsAi.dlg.recheck")}</button>
            <button type="button" onClick={onBootstrap} disabled={bootstrapLoading || (passwordNeeded && !bootstrapPassword.trim())} className="inline-flex items-center justify-center gap-2 rounded-xl bg-cs2-accent px-4 py-2.5 text-[11px] font-bold text-cs2-text-on-accent hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-45">
              {bootstrapLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Power className="h-4 w-4" />}
              {bootstrapLoading ? t("settings.obsAi.dlg.connecting") : primaryLabel}
            </button>
          </div>
          {!ffmpegReady && <p className="text-right text-[9px] text-cs2-text-muted">{t("settings.obsAi.dlg.ffmpegMissing")}</p>}
        </div>
      </div>
    </div>
  );
}

function LockedWorkspace({ discoveryLoading, onOpen }) {
  const t = useT();
  return (
    <div className="rounded-2xl border border-dashed border-cs2-accent/35 bg-[radial-gradient(circle_at_top_right,rgba(224,127,10,0.09),transparent_45%)] p-8 text-center">
      <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl border border-cs2-accent/25 bg-cs2-accent/10 text-cs2-accent">
        {discoveryLoading ? <Loader2 className="h-5 w-5 animate-spin" /> : <LockKeyhole className="h-5 w-5" />}
      </span>
      <h3 className="mt-4 text-sm font-bold text-cs2-text-primary">{discoveryLoading ? t("settings.obsAi.checking") : t("settings.obsAi.locked.title")}</h3>
      <p className="mx-auto mt-1 max-w-xl text-[11px] leading-relaxed text-cs2-text-secondary">{t("settings.obsAi.locked.body")}</p>
      {!discoveryLoading && <button type="button" onClick={onOpen} className="mt-4 inline-flex items-center gap-2 rounded-xl bg-cs2-accent px-4 py-2.5 text-[11px] font-bold text-cs2-text-on-accent"><RadioTower className="h-4 w-4" />{t("settings.obsAi.connectObs")}</button>}
    </div>
  );
}

function friendlyCurrentEncoder(raw, t) {
  const value = String(raw || "").trim();
  const lower = value.toLowerCase();
  if (!value) return t("settings.obsAi.notRead");
  if (lower.includes("nvenc") || lower === "jim_nvenc") return "NVIDIA NVENC H.264";
  if (lower.includes("qsv")) return t("settings.obsAi.enc.qsv");
  if (lower.includes("amf")) return t("settings.obsAi.enc.amf");
  if (lower.includes("x264")) return t("settings.obsAi.enc.x264");
  if (lower.includes("stream")) return t("settings.obsAi.enc.stream");
  return value;
}

function friendlyCurrentFormat(raw, t) {
  const value = String(raw || "").trim();
  const lower = value.toLowerCase();
  if (!value) return t("settings.obsAi.notRead");
  if (lower === "hybrid_mp4") return "Hybrid MP4";
  if (lower.includes("fragmented_mp4")) return t("settings.obsAi.fmt.fragmented");
  return value.toUpperCase();
}

function CurrentObsConfiguration({ discovery, previewMode, refreshing, kept, onKeep, onRefresh, onUseAi }) {
  const t = useT();
  const fallback = previewMode ? {
    video: { base_width: 2560, base_height: 1440, output_width: 2560, output_height: 1440, fps_num: 60, fps_den: 1 },
    recording: { output_mode: "Simple", encoder: "jim_nvenc", format: "hybrid_mp4" },
    active_profile: "CS2",
  } : {};
  const obs = discovery?.obs || fallback;
  const video = obs.video || {};
  const recording = obs.recording || {};
  const outputWidth = Number(video.output_width || 0);
  const outputHeight = Number(video.output_height || 0);
  const baseWidth = Number(video.base_width || 0);
  const baseHeight = Number(video.base_height || 0);
  const fpsNum = Number(video.fps_num || 0);
  const fpsDen = Number(video.fps_den || 1);
  const hasVideo = outputWidth > 0 && outputHeight > 0 && fpsNum > 0;
  const rows = [
    [Monitor, t("settings.obsAi.cur.resolution"), hasVideo ? `${outputWidth} × ${outputHeight}` : t("settings.obsAi.notRead"), baseWidth && baseHeight ? t("settings.obsAi.cur.canvas", { width: baseWidth, height: baseHeight }) : t("settings.obsAi.cur.canvasWaiting")],
    [RadioTower, t("settings.obsAi.cur.fps"), fpsNum ? `${fpsNum} / ${fpsDen} FPS` : t("settings.obsAi.notRead"), fpsDen === 1 ? t("settings.obsAi.cur.intFps") : t("settings.obsAi.cur.nonIntFps")],
    [ShieldCheck, t("settings.obsAi.cur.encoder"), friendlyCurrentEncoder(recording.encoder, t), recording.output_mode ? t("settings.obsAi.cur.outputMode", { mode: recording.output_mode }) : t("settings.obsAi.cur.modeWaiting")],
    [FileCheck2, t("settings.obsAi.cur.format"), friendlyCurrentFormat(recording.format, t), obs.active_profile ? t("settings.obsAi.cur.profile", { profile: obs.active_profile }) : t("settings.obsAi.cur.profileFallback")],
  ];
  return (
    <section className="overflow-hidden rounded-2xl border border-cs2-border bg-cs2-bg-card">
      <div className="border-b border-cs2-border bg-[radial-gradient(circle_at_top_right,rgba(224,127,10,0.12),transparent_45%)] p-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-start gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-emerald-400/25 bg-emerald-400/10 text-cs2-text-success"><CheckCircle2 className="h-5 w-5" /></span>
            <div><div className="flex flex-wrap items-center gap-2"><h2 className="text-[15px] font-bold text-cs2-text-primary">{t("settings.obsAi.cur.title")}</h2><span className="rounded-full border border-emerald-400/30 bg-emerald-400/10 px-2 py-0.5 text-[9px] font-bold text-emerald-300">{t("settings.obsAi.cur.readOnly")}</span></div><p className="mt-1 max-w-3xl text-[11px] leading-relaxed text-cs2-text-secondary">{t("settings.obsAi.cur.intro")}</p></div>
          </div>
          <button type="button" onClick={onRefresh} disabled={refreshing || previewMode} className="inline-flex shrink-0 items-center gap-2 rounded-xl border border-cs2-border bg-cs2-bg-input px-3 py-2 text-[10px] font-semibold text-cs2-text-secondary disabled:opacity-45"><RefreshCw className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} />{t("settings.obsAi.cur.reread")}</button>
        </div>
      </div>
      <div className="p-5">
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
          {rows.map(([Icon, label, value, detail]) => <div key={label} className="rounded-xl border border-cs2-border bg-cs2-bg-input/35 p-4"><div className="flex items-center gap-2 text-[9px] font-bold uppercase tracking-[0.12em] text-cs2-text-muted"><Icon className="h-3.5 w-3.5 text-cs2-accent" />{label}</div><div className="mt-2 break-words font-mono text-[13px] font-bold text-cs2-text-primary">{value}</div><div className="mt-1 text-[9px] text-cs2-text-muted">{detail}</div></div>)}
        </div>
        {kept && <div className="mt-4 flex items-start gap-2 rounded-xl border border-emerald-400/25 bg-emerald-400/[0.05] px-3 py-2.5 text-[10px] text-cs2-text-secondary"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-cs2-text-success" /><span><strong className="text-cs2-text-success">{t("settings.obsAi.cur.keptTitle")}</strong> {t("settings.obsAi.cur.keptBody")}</span></div>}
        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-end">
          <button type="button" onClick={onKeep} className="rounded-xl border border-cs2-border bg-cs2-bg-input px-4 py-2.5 text-[11px] font-semibold text-cs2-text-secondary">{t("settings.obsAi.cur.keep")}</button>
          <button type="button" onClick={onUseAi} disabled={!hasVideo} className="inline-flex items-center justify-center gap-2 rounded-xl bg-cs2-accent px-4 py-2.5 text-[11px] font-bold text-cs2-text-on-accent disabled:cursor-not-allowed disabled:opacity-45"><WandSparkles className="h-4 w-4" />{t("settings.obsAi.cur.useAi")}</button>
        </div>
        {!hasVideo && <p className="mt-2 text-right text-[9px] text-amber-300">{t("settings.obsAi.cur.noVideo")}</p>}
      </div>
    </section>
  );
}

function friendlyChangeLabel(key, t) {
  if (key === "video.fps") return t("settings.obsAi.chg.fps");
  if (key === "video.output_resolution") return t("settings.obsAi.chg.resolution");
  if (key === "recording.encoder") return t("settings.obsAi.chg.encoder");
  if (key === "recording.format") return t("settings.obsAi.chg.format");
  return key;
}

function PlanWorkspace({ plan, loading, onApply, onBack }) {
  const t = useT();
  if (loading || !plan) {
    return <div className="flex min-h-64 items-center justify-center rounded-2xl border border-cs2-border bg-cs2-bg-card text-[11px] text-cs2-text-muted"><Loader2 className="mr-2 h-4 w-4 animate-spin" />{t("settings.obsAi.plan.analyzing")}</div>;
  }
  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_300px]">
      <section className="rounded-2xl border border-cs2-border bg-cs2-bg-card p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2"><h2 className="text-[15px] font-bold text-cs2-text-primary">{t("settings.obsAi.plan.title")}</h2><span className={`rounded-full border px-2 py-0.5 text-[9px] font-bold ${plan.can_apply ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-300" : "border-amber-400/30 bg-amber-400/10 text-amber-300"}`}>{plan.can_apply ? t("settings.obsAi.plan.canApply") : t("settings.obsAi.plan.blocked")}</span></div>
            <p className="mt-1 text-[11px] text-cs2-text-secondary">{t("settings.obsAi.plan.confirmOnly")}</p>
          </div>
          <span className="rounded-lg border border-cs2-border bg-cs2-bg-input px-2.5 py-1.5 font-mono text-[9px] text-cs2-text-muted">{plan.plan_id}</span>
        </div>

        {plan.blockers?.length > 0 && <div className="mt-4 rounded-xl border border-amber-400/25 bg-amber-400/[0.05] px-3 py-2.5 text-[10px] text-amber-200"><div className="font-bold">{t("settings.obsAi.plan.blockers")}</div><ul className="mt-1.5 space-y-1">{plan.blockers.map((item) => <li key={item}>· {item}</li>)}</ul></div>}
        <div className="mt-4 overflow-hidden rounded-xl border border-cs2-border">
          <div className="grid grid-cols-[1.1fr_0.85fr_0.85fr] gap-2 border-b border-cs2-border bg-cs2-bg-input/60 px-3 py-2 text-[9px] font-bold uppercase tracking-wider text-cs2-text-muted"><span>{t("settings.obsAi.plan.colItem")}</span><span>{t("settings.obsAi.plan.colNow")}</span><span>{t("settings.obsAi.plan.colTarget")}</span></div>
          {(plan.changes || []).map((change) => (
            <div key={change.key} className="grid grid-cols-[1.1fr_0.85fr_0.85fr] gap-2 border-b border-cs2-border/60 px-3 py-3 text-[10px] last:border-0"><span className="font-semibold text-cs2-text-secondary">{friendlyChangeLabel(change.key, t)}</span><span className="truncate font-mono text-cs2-text-muted">{change.current}</span><span className="truncate font-mono font-semibold text-cs2-accent">{change.target}</span></div>
          ))}
        </div>
        <div className="mt-5 flex flex-wrap justify-between gap-2">
          <button type="button" onClick={onBack} className="rounded-xl border border-cs2-border bg-cs2-bg-input px-4 py-2.5 text-[11px] font-semibold text-cs2-text-secondary">{t("settings.obsAi.plan.back")}</button>
          <button type="button" onClick={onApply} disabled={!plan.can_apply} className="inline-flex items-center gap-2 rounded-xl bg-cs2-accent px-4 py-2.5 text-[11px] font-bold text-cs2-text-on-accent hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-45"><ShieldCheck className="h-4 w-4" />{t("settings.obsAi.plan.apply")}</button>
        </div>
      </section>
      <aside className="space-y-3">
        <div className={`rounded-2xl border p-4 ${plan.ai_review?.used ? "border-cs2-accent/25 bg-cs2-accent/[0.05]" : "border-cs2-border bg-cs2-bg-card"}`}>
          <div className="flex items-center justify-between gap-2"><div className="flex items-center gap-2 text-[12px] font-bold text-cs2-text-primary"><Sparkles className="h-4 w-4 text-cs2-accent" />{t("settings.obsAi.plan.analysis")}</div><span className={`rounded-full border px-2 py-0.5 text-[9px] font-bold ${plan.ai_review?.used ? "border-cs2-accent/30 bg-cs2-accent/10 text-cs2-accent" : "border-cs2-border bg-cs2-bg-input text-cs2-text-muted"}`}>{plan.ai_review?.used ? plan.ai_review.model || t("settings.obsAi.plan.aiDone") : t("settings.obsAi.plan.localResult")}</span></div>
          <p className="mt-2 text-[10px] leading-relaxed text-cs2-text-secondary">{plan.ai_review?.summary || plan.ai_review?.message || t("settings.obsAi.plan.summaryFallback")}</p>
          {!plan.ai_review?.used && <p className="mt-2 text-[9px] leading-relaxed text-cs2-text-muted">{t("settings.obsAi.plan.notFinal")}</p>}
          {plan.ai_review?.reasons?.length > 0 && <ul className="mt-2 space-y-1 text-[9px] leading-relaxed text-cs2-text-muted">{plan.ai_review.reasons.map((item) => <li key={item}>· {item}</li>)}</ul>}
        </div>
        <div className="rounded-2xl border border-emerald-400/20 bg-emerald-400/[0.04] p-4">
          <div className="flex items-center gap-2 text-[12px] font-bold text-cs2-text-success"><ShieldCheck className="h-4 w-4" />{t("settings.obsAi.plan.protect")}</div>
          <ul className="mt-3 space-y-2 text-[10px] leading-relaxed text-cs2-text-secondary">{[t("settings.obsAi.plan.guard1"), t("settings.obsAi.plan.guard2"), t("settings.obsAi.plan.guard3"), t("settings.obsAi.plan.guard4")].map((item) => <li key={item} className="flex gap-2"><Check className="mt-0.5 h-3 w-3 shrink-0 text-cs2-text-success" />{item}</li>)}</ul>
        </div>
        <div className="rounded-2xl border border-cs2-border bg-cs2-bg-card p-4">
          <div className="flex items-center gap-2 text-[12px] font-bold text-cs2-text-primary"><FileCheck2 className="h-4 w-4 text-cs2-accent" />{t("settings.obsAi.plan.untouched")}</div>
          <p className="mt-2 text-[9px] leading-relaxed text-cs2-text-muted">{t("settings.obsAi.plan.untouchedList")}</p>
        </div>
      </aside>
    </div>
  );
}

const APPLY_STEPS = [
  "settings.obsAi.apply.step1",
  "settings.obsAi.apply.step2",
  "settings.obsAi.apply.step3",
  "settings.obsAi.apply.step4",
  "settings.obsAi.apply.step5",
  "settings.obsAi.apply.step6",
  "settings.obsAi.apply.step7",
  "settings.obsAi.apply.step8",
];

function estimatedApplyProgress(elapsedSeconds, testSeconds, t) {
  const recordingStart = 6;
  const recordingEnd = recordingStart + Number(testSeconds || 10);
  if (elapsedSeconds < 1) return { index: 0, detail: t("settings.obsAi.apply.detail1") };
  if (elapsedSeconds < 2) return { index: 1, detail: t("settings.obsAi.apply.detail2") };
  if (elapsedSeconds < 3) return { index: 2, detail: t("settings.obsAi.apply.detail3") };
  if (elapsedSeconds < 4) return { index: 3, detail: t("settings.obsAi.apply.detail4") };
  if (elapsedSeconds < 5) return { index: 4, detail: t("settings.obsAi.apply.detail5") };
  if (elapsedSeconds < recordingStart) return { index: 5, detail: t("settings.obsAi.apply.detail6") };
  if (elapsedSeconds < recordingEnd) return { index: 6, detail: t("settings.obsAi.apply.recording", { total: testSeconds, current: Math.max(1, elapsedSeconds - recordingStart + 1) }) };
  return { index: 7, detail: elapsedSeconds < recordingEnd + 15 ? t("settings.obsAi.apply.probing") : t("settings.obsAi.apply.slow") };
}

function ApplyWorkspace({ result, loading, elapsedSeconds = 0, testSeconds = 10, onBack, onRetry, onViewReport }) {
  const t = useT();
  const video = result?.actual?.video;
  const success = Boolean(result?.ok);
  const tested = Boolean(result?.validation || result?.test_file);
  const unstable = result?.status === "unstable";
  const events = result?.events || [];
  const reconnectNeeded = ["connection_lost", "connection_failed", "video_settings_unavailable"].includes(result?.status);
  const reconfirmNeeded = ["stale_plan", "environment_changed"].includes(result?.status);
  const liveProgress = estimatedApplyProgress(elapsedSeconds, testSeconds, t);
  const liveEvents = APPLY_STEPS.map((label, index) => ({
    step: String(index),
    label: t(label),
    status: index === liveProgress.index ? "running" : index < liveProgress.index ? "estimated" : "pending",
    detail: index < liveProgress.index ? t("settings.obsAi.apply.estimatedDone") : index === liveProgress.index ? liveProgress.detail : t("settings.obsAi.apply.waitPrev"),
  }));
  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_300px]">
      <section className={`rounded-2xl border bg-cs2-bg-card p-5 ${success ? "border-emerald-400/25" : result ? "border-amber-400/25" : "border-cs2-border"}`}>
        <div className="flex items-start gap-3">
          <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border ${success ? "border-emerald-400/25 bg-emerald-400/10 text-cs2-text-success" : result ? "border-amber-400/25 bg-amber-400/10 text-amber-300" : "border-cs2-accent/25 bg-cs2-accent/10 text-cs2-accent"}`}>
            {loading ? <Loader2 className="h-5 w-5 animate-spin" /> : success ? <CheckCircle2 className="h-5 w-5" /> : <AlertTriangle className="h-5 w-5" />}
          </span>
          <div>
            <h2 className="text-[15px] font-bold text-cs2-text-primary">{loading ? t("settings.obsAi.apply.running") : success ? t("settings.obsAi.apply.passed") : unstable ? t("settings.obsAi.apply.unstable") : t("settings.obsAi.apply.incomplete")}</h2>
            <p className="mt-1 text-[11px] leading-relaxed text-cs2-text-secondary">{loading ? liveProgress.detail : result?.message || t("settings.obsAi.apply.preparing")}</p>
          </div>
        </div>

        {loading && <div className="mt-4 rounded-xl border border-cs2-border bg-cs2-bg-input/30 p-3"><div className="flex items-center justify-between text-[9px] text-cs2-text-muted"><span>{t("settings.obsAi.apply.progress", { seconds: elapsedSeconds })}</span><span>{t("settings.obsAi.apply.afterRecord")}</span></div><div className="mt-2 h-1.5 overflow-hidden rounded-full bg-cs2-bg-card"><div className="h-full rounded-full bg-cs2-accent transition-all duration-500" style={{ width: `${Math.min(96, Math.max(5, elapsedSeconds / (Number(testSeconds || 10) + 18) * 100))}%` }} /></div></div>}

        <div className="mt-5 space-y-2">
          {(loading ? liveEvents : events).map((event) => {
            const done = event.status === "ok";
            const failed = ["failed", "blocked"].includes(event.status);
            return (
              <div key={`${event.step}-${event.label}`} className="flex items-start gap-3 rounded-xl border border-cs2-border/75 bg-cs2-bg-input/35 px-3 py-3">
                <span className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${done ? "bg-emerald-400/10 text-cs2-text-success" : failed ? "bg-amber-400/10 text-amber-300" : "bg-cs2-accent/10 text-cs2-accent"}`}>
                  {done ? <Check className="h-3.5 w-3.5" /> : failed ? <AlertTriangle className="h-3.5 w-3.5" /> : <Loader2 className={`h-3.5 w-3.5 ${event.status === "running" ? "animate-spin" : "opacity-35"}`} />}
                </span>
                <div className="min-w-0"><div className="text-[11px] font-bold text-cs2-text-primary">{event.label}</div><div className="mt-0.5 text-[9px] leading-relaxed text-cs2-text-muted">{event.detail}</div></div>
              </div>
            );
          })}
        </div>

        {video && (
          <div className="mt-4 grid gap-2 sm:grid-cols-3">
            <div className="rounded-xl border border-emerald-400/20 bg-emerald-400/[0.04] p-3"><div className="text-[9px] font-bold text-cs2-text-muted">{t("settings.obsAi.apply.actualRes")}</div><div className="mt-1 font-mono text-[14px] font-bold text-cs2-text-primary">{video.output_width} × {video.output_height}</div><div className="mt-1 text-[9px] text-cs2-text-muted">{t("settings.obsAi.apply.canvasStill", { width: video.base_width, height: video.base_height })}</div></div>
            <div className="rounded-xl border border-emerald-400/20 bg-emerald-400/[0.04] p-3"><div className="text-[9px] font-bold text-cs2-text-muted">{t("settings.obsAi.apply.actualFps")}</div><div className="mt-1 font-mono text-[14px] font-bold text-cs2-text-primary">{video.fps_num} / {video.fps_den} FPS</div><div className="mt-1 text-[9px] text-cs2-text-muted">{t("settings.obsAi.apply.intConfirmed")}</div></div>
            {result?.actual?.recording && <div className="rounded-xl border border-emerald-400/20 bg-emerald-400/[0.04] p-3"><div className="text-[9px] font-bold text-cs2-text-muted">{t("settings.obsAi.chg.encoder")}</div><div className="mt-1 truncate text-[12px] font-bold text-cs2-text-primary">{result.actual.recording.encoder_label}</div><div className="mt-1 text-[9px] text-cs2-text-muted">Hybrid MP4</div></div>}
          </div>
        )}

        {!loading && (
          <div className="mt-5 flex flex-wrap justify-between gap-2">
            <button type="button" onClick={onBack} className="rounded-xl border border-cs2-border bg-cs2-bg-input px-4 py-2.5 text-[11px] font-semibold text-cs2-text-secondary">{t("settings.obsAi.apply.back")}</button>
            <div className="flex flex-wrap gap-2">{!success && <button type="button" onClick={onRetry} className="inline-flex items-center gap-2 rounded-xl border border-cs2-border bg-cs2-bg-input px-4 py-2.5 text-[11px] font-bold text-cs2-text-secondary"><RefreshCw className="h-4 w-4" />{reconnectNeeded ? t("settings.obsAi.apply.reconnect") : reconfirmNeeded ? t("settings.obsAi.apply.reconfirm") : t("settings.obsAi.apply.retry")}</button>}{tested && <button type="button" onClick={onViewReport} className="inline-flex items-center gap-2 rounded-xl bg-cs2-accent px-4 py-2.5 text-[11px] font-bold text-cs2-text-on-accent"><FileCheck2 className="h-4 w-4" />{t("settings.obsAi.apply.viewReport")}</button>}</div>
          </div>
        )}
      </section>

      <aside className="space-y-3">
        {result?.backup && <div className="rounded-2xl border border-emerald-400/20 bg-emerald-400/[0.04] p-4"><div className="flex items-center gap-2 text-[12px] font-bold text-cs2-text-success"><ShieldCheck className="h-4 w-4" />{t("settings.obsAi.apply.backupSaved")}</div><p className="mt-2 text-[10px] leading-relaxed text-cs2-text-secondary">{t("settings.obsAi.apply.backupHint")}</p><p title={result.backup.path} className="mt-2 truncate font-mono text-[9px] text-cs2-text-muted">{result.backup.path}</p></div>}
        <div className={`rounded-2xl border p-4 ${result?.validation?.passed ? "border-emerald-400/20 bg-emerald-400/[0.04]" : "border-amber-400/20 bg-amber-400/[0.04]"}`}><div className={`flex items-center gap-2 text-[12px] font-bold ${result?.validation?.passed ? "text-cs2-text-success" : "text-amber-200"}`}><FileCheck2 className="h-4 w-4" />{result?.validation ? result.validation.passed ? t("settings.obsAi.apply.testPassed") : t("settings.obsAi.apply.testFailed") : t("settings.obsAi.apply.testWaiting")}</div><p className="mt-2 text-[10px] leading-relaxed text-cs2-text-secondary">{result?.validation ? result.validation.passed ? t("settings.obsAi.apply.testPassedBody") : t("settings.obsAi.apply.testFailedBody") : t("settings.obsAi.apply.testWaitingBody")}</p></div>
      </aside>
    </div>
  );
}

function ReportWorkspace({ result, onBack, onRestore, restoreLoading, restoreResult }) {
  const t = useT();
  const validation = result?.validation || {};
  const media = result?.actual?.ffprobe || {};
  const mediaVideo = media.video || {};
  const stats = result?.actual?.stats || {};
  const logs = result?.actual?.logs || {};
  const passed = Boolean(validation.passed);
  return (
    <div className="space-y-4">
      <section className={`rounded-2xl border p-5 ${passed ? "border-emerald-400/25 bg-emerald-400/[0.035]" : "border-amber-400/25 bg-amber-400/[0.035]"}`}>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-start gap-3"><span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${passed ? "bg-emerald-400/10 text-cs2-text-success" : "bg-amber-400/10 text-amber-300"}`}>{passed ? <CheckCircle2 className="h-5 w-5" /> : <AlertTriangle className="h-5 w-5" />}</span><div><h2 className="text-base font-bold text-cs2-text-primary">{passed ? t("settings.obsAi.rep.passed") : t("settings.obsAi.rep.failed")}</h2><p className="mt-1 text-[11px] leading-relaxed text-cs2-text-secondary">{result?.message}</p></div></div>
          <span className={`rounded-full border px-3 py-1 text-[10px] font-bold ${passed ? "border-emerald-400/30 bg-emerald-400/10 text-cs2-text-success" : "border-amber-400/30 bg-amber-400/10 text-amber-200"}`}>{passed ? t("settings.obsAi.rep.usable") : t("settings.obsAi.rep.retest")}</span>
        </div>
        {!passed && validation.reasons?.length > 0 && <div className="mt-4 rounded-xl border border-amber-400/20 bg-black/10 p-3"><div className="text-[10px] font-bold text-amber-200">{t("settings.obsAi.rep.reasons")}</div><ul className="mt-2 space-y-1 text-[10px] text-cs2-text-secondary">{validation.reasons.map((item) => <li key={item}>· {item}</li>)}</ul>{validation.minimum_adjustment && <p className="mt-2 border-t border-cs2-border/60 pt-2 text-[10px] text-cs2-text-primary">{t("settings.obsAi.rep.minAdjust", { value: validation.minimum_adjustment })}</p>}</div>}
      </section>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[
          [t("settings.obsAi.rep.fileFps"), `${mediaVideo.r_frame_rate || t("settings.obsAi.unknown")}`, t("settings.obsAi.rep.avg", { value: mediaVideo.avg_frame_rate || t("settings.obsAi.unknown") }), validation.r_frame_rate_ok && validation.avg_frame_rate_ok],
          [t("settings.obsAi.rep.videoRes"), `${mediaVideo.width || 0} × ${mediaVideo.height || 0}`, mediaVideo.codec_name || t("settings.obsAi.rep.codecUnknown"), validation.media_resolution_ok],
          [t("settings.obsAi.rep.renderDrop"), stats.rendering_lag_percent == null ? t("settings.obsAi.unknown") : `${stats.rendering_lag_percent}%`, t("settings.obsAi.rep.frames", { skipped: stats.render_skipped_frames || 0, total: stats.render_total_frames || 0 }), stats.rendering_lag_percent != null && stats.rendering_lag_percent <= 1],
          [t("settings.obsAi.rep.encodeDrop"), stats.encoding_lag_percent == null ? t("settings.obsAi.unknown") : `${stats.encoding_lag_percent}%`, t("settings.obsAi.rep.frames", { skipped: stats.output_skipped_frames || 0, total: stats.output_total_frames || 0 }), stats.encoding_lag_percent != null && stats.encoding_lag_percent <= 1],
        ].map(([label, value, detail, ok]) => <div key={label} className={`rounded-xl border p-3.5 ${ok ? "border-emerald-400/20 bg-emerald-400/[0.035]" : "border-amber-400/20 bg-cs2-bg-card"}`}><div className="text-[9px] font-bold uppercase tracking-wider text-cs2-text-muted">{label}</div><div className="mt-2 font-mono text-[14px] font-bold text-cs2-text-primary">{value}</div><div className="mt-1 text-[9px] text-cs2-text-muted">{detail}</div></div>)}
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
        <section className="rounded-2xl border border-cs2-border bg-cs2-bg-card p-4">
          <h3 className="text-[12px] font-bold text-cs2-text-primary">{t("settings.obsAi.rep.testFile")}</h3>
          <div className="mt-3 grid gap-2 sm:grid-cols-2"><div className="rounded-xl border border-cs2-border bg-cs2-bg-input/35 p-3"><div className="text-[9px] text-cs2-text-muted">{t("settings.obsAi.rep.fileLocation")}</div><div title={result?.test_file} className="mt-1 truncate font-mono text-[10px] text-cs2-text-secondary">{result?.test_file || t("settings.obsAi.rep.notGenerated")}</div></div><div className="rounded-xl border border-cs2-border bg-cs2-bg-input/35 p-3"><div className="text-[9px] text-cs2-text-muted">{t("settings.obsAi.rep.durSizeTracks")}</div><div className="mt-1 text-[10px] text-cs2-text-secondary">{t("settings.obsAi.rep.seconds", { seconds: media.duration_seconds || 0 })} · {media.size_bytes ? `${(media.size_bytes / 1024 / 1024).toFixed(1)} MB` : t("settings.obsAi.rep.sizeUnknown")} · {t("settings.obsAi.rep.tracks", { n: (media.audio_tracks || []).length })}</div></div></div>
          <div className="mt-3 rounded-xl border border-cs2-border bg-cs2-bg-input/25 p-3 text-[10px] leading-relaxed text-cs2-text-secondary">{t("settings.obsAi.rep.liveFps")}<span className="font-mono text-cs2-text-primary">{stats.active_fps ?? t("settings.obsAi.unknown")}</span>{t("settings.obsAi.rep.avgRender")}<span className="font-mono text-cs2-text-primary">{stats.average_frame_render_time_ms ?? t("settings.obsAi.unknown")} ms</span>{t("settings.obsAi.rep.overload")}<span className="font-mono text-cs2-text-primary">{logs.encoding_overload_mentions ?? 0}</span>{t("settings.obsAi.rep.times")}</div>
        </section>
        <aside className="rounded-2xl border border-cs2-border bg-cs2-bg-card p-4">
          <div className="flex items-center gap-2 text-[12px] font-bold text-cs2-text-primary"><ShieldCheck className="h-4 w-4 text-cs2-accent" />{t("settings.obsAi.rep.restoreTitle")}</div><p className="mt-2 text-[10px] leading-relaxed text-cs2-text-secondary">{t("settings.obsAi.rep.restoreHint")}</p>
          {restoreResult && <div className={`mt-3 rounded-lg border px-3 py-2 text-[9px] ${restoreResult.ok ? "border-emerald-400/20 text-cs2-text-success" : "border-amber-400/20 text-amber-200"}`}>{restoreResult.message}</div>}
          <button type="button" disabled={!result?.backup?.id || restoreLoading} onClick={onRestore} className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-xl border border-cs2-border bg-cs2-bg-input px-3 py-2.5 text-[10px] font-bold text-cs2-text-secondary disabled:opacity-40">{restoreLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}{t("settings.obsAi.rep.restore")}</button>
        </aside>
      </div>

      <button type="button" onClick={onBack} className="rounded-xl border border-cs2-border bg-cs2-bg-input px-4 py-2.5 text-[11px] font-semibold text-cs2-text-secondary">{t("settings.obsAi.rep.back")}</button>
    </div>
  );
}

export default function ObsAiSettingsPanel({
  obsPath,
  obsConnected,
  ffmpegReady,
  autoPrepare = false,
  onAutoPrepareChange,
  previewMode = false,
}) {
  const t = useT();
  const [goal, setGoal] = useState({ resolution: "current", fps: 60, fpsDraft: "60", priority: "balanced", useCase: "slowmo", codec: "auto", testSeconds: 10 });
  const [screen, setScreen] = useState("overview");
  const [keepCurrentConfirmed, setKeepCurrentConfirmed] = useState(false);
  const [discovery, setDiscovery] = useState(null);
  const [discoveryLoading, setDiscoveryLoading] = useState(!previewMode);
  const [recommendationResult, setRecommendationResult] = useState(null);
  const [recommendationLoading, setRecommendationLoading] = useState(false);
  const [plan, setPlan] = useState(null);
  const [planLoading, setPlanLoading] = useState(false);
  const [applyResult, setApplyResult] = useState(null);
  const [applyLoading, setApplyLoading] = useState(false);
  const [applyElapsedSeconds, setApplyElapsedSeconds] = useState(0);
  const [restoreLoading, setRestoreLoading] = useState(false);
  const [restoreResult, setRestoreResult] = useState(null);
  const [bootstrapLoading, setBootstrapLoading] = useState(false);
  const [bootstrapResult, setBootstrapResult] = useState(null);
  const [bootstrapPassword, setBootstrapPassword] = useState("");
  const [previewConnected, setPreviewConnected] = useState(Boolean(obsConnected));
  const [connectionDialogOpen, setConnectionDialogOpen] = useState(!previewMode || !obsConnected);
  const [connectionDismissed, setConnectionDismissed] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const autoPrepareAttemptedRef = useRef(false);

  const goalPayload = useMemo(() => ({
    resolution: goal.resolution,
    fps: goal.fps,
    use_case: goal.useCase,
    priority: goal.priority,
    codec: goal.codec,
    test_seconds: goal.testSeconds,
  }), [goal]);
  const fallbackRecommendation = useMemo(() => buildFallbackRecommendation(goal, t), [goal, t]);
  const recommendation = useMemo(() => toWorkspaceRecommendation(recommendationResult, fallbackRecommendation, t), [fallbackRecommendation, recommendationResult, t]);
  const selectedOutput = useMemo(() => selectedOutputDimensions(goal, discovery), [discovery, goal]);
  const effectiveConnected = previewMode
    ? previewConnected
    : discovery
      ? Boolean(discovery?.obs?.connected)
      : Boolean(bootstrapResult?.ok || obsConnected);
  const effectiveObsPath = discovery?.obs?.install_path || obsPath;
  const effectiveFfmpegReady = discovery?.ffmpeg?.usable ?? ffmpegReady;
  const effectiveFfprobeReady = discovery?.ffmpeg?.ffprobe_usable ?? ffmpegReady;
  const connectionDiscovery = discovery || {
    obs: {
      install_detected: Boolean(effectiveObsPath),
      install_path: effectiveObsPath,
      connected: effectiveConnected,
      host: "localhost",
      port: 4455,
    },
  };

  const refreshDiscovery = useCallback(async () => {
    if (previewMode) return;
    setDiscoveryLoading(true);
    setErrorMessage("");
    try {
      const next = await discoverObsTuningEnvironment();
      setDiscovery(next);
    } catch (error) {
      setErrorMessage(error?.response?.data?.detail || error?.message || t("settings.obsAi.err.discovery"));
    } finally {
      setDiscoveryLoading(false);
    }
  }, [previewMode, t]);

  useEffect(() => { void refreshDiscovery(); }, [refreshDiscovery]);

  useEffect(() => {
    if (discoveryLoading) return;
    if (effectiveConnected) {
      setConnectionDialogOpen(false);
      setConnectionDismissed(false);
    } else if (!connectionDismissed) {
      setConnectionDialogOpen(true);
    }
  }, [connectionDismissed, discoveryLoading, effectiveConnected]);

  const handleBootstrap = useCallback(async () => {
    if (bootstrapLoading) return;
    if (previewMode) {
      setBootstrapResult({ ok: true, status: "connected", events: [] });
      setPreviewConnected(true);
      setConnectionDialogOpen(false);
      return;
    }
    setBootstrapLoading(true);
    setErrorMessage("");
    try {
      const next = await bootstrapObsTuningEnvironment({ password: bootstrapPassword });
      setBootstrapResult(next);
      if (next.ok) {
        setBootstrapPassword("");
        await refreshDiscovery();
        setScreen("overview");
        setKeepCurrentConfirmed(false);
        setConnectionDialogOpen(false);
      }
    } catch (error) {
      setErrorMessage(error?.response?.data?.detail || error?.message || t("settings.obsAi.err.bootstrap"));
    } finally {
      setBootstrapLoading(false);
    }
  }, [bootstrapLoading, bootstrapPassword, previewMode, refreshDiscovery, t]);

  useEffect(() => {
    if (previewMode || !autoPrepare || autoPrepareAttemptedRef.current || discoveryLoading || !discovery || effectiveConnected) return;
    autoPrepareAttemptedRef.current = true;
    void handleBootstrap();
  }, [autoPrepare, discovery, discoveryLoading, effectiveConnected, handleBootstrap, previewMode]);

  useEffect(() => {
    setPlan(null);
    setApplyResult(null);
    setRestoreResult(null);
    setScreen((current) => current === "overview" ? "overview" : "goal");
  }, [goalPayload]);

  useEffect(() => {
    if (!applyLoading) return undefined;
    setApplyElapsedSeconds(0);
    const timer = window.setInterval(() => setApplyElapsedSeconds((seconds) => seconds + 1), 1000);
    return () => window.clearInterval(timer);
  }, [applyLoading]);

  useEffect(() => {
    if (previewMode || !discovery || !effectiveConnected) {
      setRecommendationResult(null);
      return undefined;
    }
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      setRecommendationLoading(true);
      try {
        const next = await recommendObsTuningGoal(goalPayload, discovery);
        if (!cancelled) setRecommendationResult(next);
      } catch (error) {
        if (!cancelled) setErrorMessage(error?.response?.data?.detail || error?.message || t("settings.obsAi.err.recommend"));
      } finally {
        if (!cancelled) setRecommendationLoading(false);
      }
    }, 220);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [discovery, effectiveConnected, goalPayload, previewMode, t]);

  const handleCreatePlan = useCallback(async () => {
    setPlanLoading(true);
    setErrorMessage("");
    setScreen("plan");
    try {
      if (previewMode) {
        setPlan({
          plan_id: "obs_preview_8f3a42d1",
          plan_hash: "8f3a42d1f6e5c4b3a291807060504030",
          can_apply: true,
          blockers: [],
          changes: [
            { key: "video.fps", current: "60/1", target: `${goal.fps}/1` },
            { key: "video.output_resolution", current: "2560×1440", target: `${selectedOutput.width} × ${selectedOutput.height}` },
            { key: "recording.encoder", current: "与直播一致", target: "NVIDIA NVENC H.264" },
            { key: "recording.format", current: "MKV", target: "Hybrid MP4（异常中断可恢复）" },
          ],
          ai_review: {
            used: true,
            model: "演示模型",
            summary: "RTX 5070 具备高帧率硬件编码能力，但 480 FPS 仍必须通过真实短录制确认。",
            reasons: ["将优先使用 NVIDIA NVENC H.264", "不会自动降低你选择的分辨率或帧率"],
          },
          protected_fields: ["audio.track_mapping", "stream.key", "websocket.password", "ffmpeg.path"],
          safety_guards: ["执行前重新探测环境", "写入前创建 Profile 备份", "写入后回读实际设置", "失败时不静默降低 FPS"],
        });
      } else {
        setPlan(await createObsTuningPlan(goalPayload));
      }
    } catch (error) {
      setErrorMessage(error?.response?.data?.detail || error?.message || t("settings.obsAi.err.plan"));
      setScreen("goal");
    } finally {
      setPlanLoading(false);
    }
  }, [goal.fps, goalPayload, previewMode, selectedOutput.height, selectedOutput.width, t]);

  const startAiAdjustment = useCallback(() => {
    const current = discovery?.obs?.video || (previewMode ? { fps_num: 60 } : {});
    const currentFps = Number(current.fps_num || 60);
    setKeepCurrentConfirmed(false);
    setGoal((previous) => ({
      ...previous,
      resolution: "current",
      fps: currentFps,
      fpsDraft: String(currentFps),
    }));
    setScreen("goal");
  }, [discovery, previewMode]);

  const handleApplyPlan = useCallback(async () => {
    if (!plan?.plan_hash || applyLoading) return;
    setApplyLoading(true);
    setApplyResult(null);
    setErrorMessage("");
    setScreen("run");
    try {
      if (previewMode) {
        await Promise.resolve();
        setApplyResult({
          ok: true,
          status: "passed",
          message: `已完成真实短录制，稳定达到 ${goal.fps} FPS。`,
          events: [
            { step: "recheck", label: "重新检查电脑和 OBS", status: "ok", detail: "连接正常，确认内容没有变化。" },
            { step: "idle", label: "检查 OBS 是否正在录制或直播", status: "ok", detail: "OBS 当前没有录制、直播或运行其他输出，可以安全修改。" },
            { step: "backup", label: "保存现在的设置", status: "ok", detail: "已经创建恢复点。" },
            { step: "apply", label: "应用分辨率和帧率", status: "ok", detail: `已请求设置为 ${selectedOutput.width} × ${selectedOutput.height}、${goal.fps} FPS。` },
            { step: "verify", label: "确认设置已经生效", status: "ok", detail: `实际为 ${selectedOutput.width} × ${selectedOutput.height}、${goal.fps}/1 FPS。` },
            { step: "encoder", label: "设置显卡录制方式", status: "ok", detail: "已回读确认 NVIDIA NVENC H.264，容器为 Hybrid MP4。" },
            { step: "record", label: "进行短录制测试", status: "ok", detail: "已完成 10 秒测试录制。" },
            { step: "probe", label: "检查测试视频和掉帧", status: "ok", detail: "ffprobe、OBS Stats 与日志检查完成。" },
          ],
          backup: { id: "obs_preview", path: "C:\\Users\\Demo\\AppData\\Local\\CS2 Insight\\backups\\obs_preview" },
          test_file: "C:\\Users\\Demo\\Videos\\OBS_OUTPUT\\obs-test.mp4",
          validation: { passed: true, verdict: "stable", media_resolution_ok: true, r_frame_rate_ok: true, avg_frame_rate_ok: true, stats_ok: true, logs_ok: true, encoder_ok: true, reasons: [] },
          actual: {
            video: {
              base_width: 2560,
              base_height: 1440,
              output_width: selectedOutput.width,
              output_height: selectedOutput.height,
              fps_num: goal.fps,
              fps_den: 1,
            },
            recording: { encoder_label: "NVIDIA NVENC H.264", values: { RecEncoder: "jim_nvenc", RecFormat2: "hybrid_mp4" } },
            ffprobe: { duration_seconds: 10.04, size_bytes: 188743680, format_name: "mov,mp4", video: { codec_name: "h264", width: selectedOutput.width, height: selectedOutput.height, r_frame_rate: `${goal.fps}/1`, avg_frame_rate: `${goal.fps}/1` }, audio_tracks: [{ index: 1, codec_name: "aac", channels: 2, sample_rate: "48000" }] },
            stats: { active_fps: goal.fps, rendering_lag_percent: 0.08, render_skipped_frames: 4, render_total_frames: 4800, encoding_lag_percent: 0.04, output_skipped_frames: 2, output_total_frames: 4800, average_frame_render_time_ms: 1.12 },
            logs: { available: true, encoding_overload_mentions: 0, render_lag_mentions: 0, nvenc_mentions: 1 },
          },
        });
      } else {
        setApplyResult(await applyObsTuningPlan(goalPayload, plan.plan_hash));
      }
    } catch (error) {
      const timedOut = error?.code === "ECONNABORTED" || error?.code === "ETIMEDOUT";
      const message = timedOut
        ? t("settings.obsAi.err.timeout")
        : error?.response?.data?.detail || error?.message || t("settings.obsAi.err.apply");
      setApplyResult({ ok: false, status: "request_failed", message, events: [] });
    } finally {
      setApplyLoading(false);
    }
  }, [applyLoading, goal.fps, goalPayload, plan, previewMode, selectedOutput.height, selectedOutput.width, t]);

  const handleApplyRecovery = useCallback(async () => {
    const status = applyResult?.status;
    if (["connection_lost", "connection_failed", "video_settings_unavailable"].includes(status)) {
      setBootstrapResult(null);
      setScreen("goal");
      setConnectionDismissed(false);
      setConnectionDialogOpen(true);
      await refreshDiscovery();
      return;
    }
    if (["stale_plan", "environment_changed"].includes(status)) {
      await handleCreatePlan();
      return;
    }
    await handleApplyPlan();
  }, [applyResult?.status, handleApplyPlan, handleCreatePlan, refreshDiscovery]);

  const handleRestore = useCallback(async () => {
    if (!applyResult?.backup?.id || restoreLoading) return;
    setRestoreLoading(true);
    setRestoreResult(null);
    try {
      if (previewMode) {
        setRestoreResult({ ok: true, message: "演示：原设置已经恢复；真实流程会要求先正常关闭 OBS。" });
      } else {
        setRestoreResult(await restoreObsTuningBackup(applyResult.backup.id));
      }
    } catch (error) {
      setRestoreResult({ ok: false, message: error?.response?.data?.detail || error?.message || t("settings.obsAi.err.restore") });
    } finally {
      setRestoreLoading(false);
    }
  }, [applyResult?.backup?.id, previewMode, restoreLoading, t]);

  const closeConnectionDialog = () => {
    if (discoveryLoading || bootstrapLoading) return;
    setConnectionDismissed(true);
    setConnectionDialogOpen(false);
  };

  return (
    <section data-testid="obs-ai-settings-panel" className="space-y-4">
      <header className="flex flex-col gap-4 rounded-2xl border border-cs2-accent/25 bg-[radial-gradient(circle_at_top_right,rgba(224,127,10,0.12),transparent_45%)] p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-cs2-accent/30 bg-cs2-accent/10 text-cs2-accent"><Sparkles className="h-5 w-5" /></span>
          <div>
            <div className="flex flex-wrap items-center gap-2"><h2 className="text-[15px] font-bold text-cs2-text-primary">{t("settings.obsAi.header.title")}</h2><span className="rounded-full border border-cs2-accent/30 bg-cs2-accent/10 px-2 py-0.5 text-[9px] font-bold text-cs2-accent">{t("settings.obsAi.header.aiOptional")}</span><span className={`rounded-full border px-2 py-0.5 text-[9px] font-bold ${effectiveConnected ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-300" : "border-amber-400/30 bg-amber-400/10 text-amber-300"}`}>{effectiveConnected ? t("settings.obsAi.header.connected") : t("settings.obsAi.header.disconnected")}</span></div>
            <p className="mt-1 text-[10px] leading-relaxed text-cs2-text-secondary">{t("settings.obsAi.header.intro")}</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-lg border border-cs2-border bg-cs2-bg-input px-2.5 py-2 text-[9px] font-semibold text-cs2-text-muted" title={effectiveObsPath || undefined}><Monitor className="h-3.5 w-3.5" />{effectiveObsPath ? t("settings.obsAi.header.found") : t("settings.obsAi.header.searching")}</span>
          <button type="button" onClick={() => { if (effectiveConnected) void refreshDiscovery(); else { setConnectionDismissed(false); setConnectionDialogOpen(true); } }} className="inline-flex items-center gap-1.5 rounded-lg border border-cs2-border bg-cs2-bg-input px-3 py-2 text-[10px] font-semibold text-cs2-text-secondary hover:border-cs2-accent/35"><RadioTower className="h-3.5 w-3.5" />{effectiveConnected ? t("settings.obsAi.header.recheck") : t("settings.obsAi.connectObs")}</button>
        </div>
      </header>

      {effectiveConnected ? (
        <>
          {errorMessage && <div className="rounded-xl border border-rose-400/30 bg-rose-400/[0.05] px-3 py-2.5 text-[10px] text-cs2-rose-on-surface">{errorMessage}</div>}
          {screen === "overview" ? (
            <CurrentObsConfiguration discovery={discovery} previewMode={previewMode} refreshing={discoveryLoading} kept={keepCurrentConfirmed} onKeep={() => setKeepCurrentConfirmed(true)} onRefresh={() => void refreshDiscovery()} onUseAi={startAiAdjustment} />
          ) : (
            <>
              <ScreenNav active={screen} onChange={setScreen} enabledKeys={applyResult?.validation || applyResult?.test_file ? ["goal", "plan", "run", "report"] : applyResult || applyLoading ? ["goal", "plan", "run"] : plan || planLoading ? ["goal", "plan"] : ["goal"]} />
              {screen === "goal" ? (
                <GoalScreen goal={goal} setGoal={setGoal} recommendation={recommendation} recommendationLoading={recommendationLoading} environment={discovery} onBack={() => setScreen("overview")} onNext={() => void handleCreatePlan()} />
              ) : screen === "plan" ? (
                <PlanWorkspace plan={plan} loading={planLoading} onApply={() => void handleApplyPlan()} onBack={() => setScreen("goal")} />
              ) : screen === "run" ? (
                <ApplyWorkspace result={applyResult} loading={applyLoading} elapsedSeconds={applyElapsedSeconds} testSeconds={goal.testSeconds} onBack={() => setScreen("plan")} onRetry={() => void handleApplyRecovery()} onViewReport={() => setScreen("report")} />
              ) : (
                <ReportWorkspace result={applyResult} onBack={() => setScreen("run")} onRestore={() => void handleRestore()} restoreLoading={restoreLoading} restoreResult={restoreResult} />
              )}
              {!effectiveFfprobeReady && <div className="flex items-start gap-2 rounded-xl border border-amber-400/25 bg-amber-400/[0.04] px-3 py-2.5 text-[10px] text-cs2-text-secondary"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-300" />{t("settings.obsAi.ffprobeMissing")}</div>}
            </>
          )}
        </>
      ) : (
        <LockedWorkspace discoveryLoading={discoveryLoading} onOpen={() => { setConnectionDismissed(false); setConnectionDialogOpen(true); }} />
      )}

      {connectionDialogOpen && !effectiveConnected && (
        <ConnectionDialog
          autoPrepare={autoPrepare}
          bootstrapLoading={bootstrapLoading}
          bootstrapPassword={bootstrapPassword}
          bootstrapResult={bootstrapResult}
          discovery={connectionDiscovery}
          discoveryLoading={discoveryLoading}
          errorMessage={errorMessage}
          ffmpegReady={effectiveFfmpegReady}
          onAutoPrepareChange={onAutoPrepareChange}
          onBootstrap={() => void handleBootstrap()}
          onClose={closeConnectionDialog}
          onPasswordChange={setBootstrapPassword}
          onRefresh={() => void refreshDiscovery()}
        />
      )}
    </section>
  );
}
