/**
 * Zoom / fit controls for the 2D replay viewport camera.
 */
import { useT } from "../../../i18n/useT.js";

export default function ReplayCameraControls({
  userZoom = 1,
  onZoomIn,
  onZoomOut,
  onFit,
  className = "top-3 left-3",
}) {
  const t = useT();
  const percent = Math.round(Number(userZoom) * 100) || 100;
  return (
    <div
      className={`pointer-events-auto absolute z-30 flex items-center gap-1 rounded-md border border-cs2-border bg-cs2-bg-card/95 p-0.5 shadow-lg ${className}`}
      role="group"
      aria-label={t("analysis.replay.zoomGroup")}
    >
      <button
        type="button"
        aria-label={t("analysis.replay.zoomOut")}
        onClick={onZoomOut}
        className="flex h-7 w-7 items-center justify-center rounded text-[12px] font-bold text-cs2-text-secondary hover:bg-cs2-bg-input hover:text-cs2-text-primary"
      >
        −
      </button>
      <span className="min-w-[3.25rem] px-1 text-center font-mono text-[10px] font-bold text-cs2-text-primary" aria-live="polite">
        {percent}%
      </span>
      <button
        type="button"
        aria-label={t("analysis.replay.zoomIn")}
        onClick={onZoomIn}
        className="flex h-7 w-7 items-center justify-center rounded text-[12px] font-bold text-cs2-text-secondary hover:bg-cs2-bg-input hover:text-cs2-text-primary"
      >
        +
      </button>
      <button
        type="button"
        aria-label={t("analysis.replay.zoomFit")}
        onClick={onFit}
        className="rounded px-2 py-1 text-[9px] font-bold text-cs2-text-muted hover:bg-cs2-bg-input hover:text-cs2-text-primary"
      >
        {t("analysis.replay.zoomFit")}
      </button>
    </div>
  );
}
