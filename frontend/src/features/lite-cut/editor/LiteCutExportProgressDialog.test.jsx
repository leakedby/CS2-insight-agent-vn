/** @vitest-environment jsdom */
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import LiteCutExportProgressDialog from "./LiteCutExportProgressDialog.jsx";

describe("LiteCutExportProgressDialog", () => {
  it("keeps an active export in a modal and exposes cancellation", () => {
    const onCancel = vi.fn();
    render(<LiteCutExportProgressDialog phase="running" result={{ export_id: 7, stage: "overlays", progress: 0.42 }} onCancel={onCancel} />);

    expect(screen.getByRole("dialog", { name: "Export progress" })).toBeTruthy();
    expect(screen.getByText("42%")).toBeTruthy();
    expect(screen.getByText("Elapsed 00:00")).toBeTruthy();
    expect(screen.queryByLabelText("Close export window")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Cancel export" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("shows live Blur frame progress and an estimated remaining time", () => {
    render(<LiteCutExportProgressDialog phase="running" result={{
      export_id: 3,
      stage: "framemeld",
      progress: 0.75,
      elapsed_seconds: 125,
      estimated_remaining_seconds: 64,
      processed_frames: 3000,
      total_frames: 7500,
    }} onCancel={vi.fn()} />);

    expect(screen.getByText(/FrameMeld motion rendering/)).toBeTruthy();
    expect(screen.getByText("Elapsed 02:05")).toBeTruthy();
    expect(screen.getByText("About 01:04 remaining")).toBeTruthy();
    expect(screen.getByText("Blur frame progress 3000 / 7500")).toBeTruthy();
  });

  it("shows the unified completion modal", () => {
    render(<LiteCutExportProgressDialog phase="done" result={{ output_path: "C:\\exports\\clip.mp4", progress: 1 }} onClose={vi.fn()} />);

    expect(screen.getByText("Export complete")).toBeTruthy();
    expect(screen.getByText("clip.mp4")).toBeTruthy();
  });

  it("reuses the progress UI and cancellation action for Montage", () => {
    const onCancel = vi.fn();
    render(<LiteCutExportProgressDialog
      variant="montage"
      phase="running"
      result={{ export_id: 18, stage: "finalizing", progress: 0.8 }}
      onClose={vi.fn()}
      onCancel={onCancel}
    />);

    expect(screen.getByText("Exporting montage…")).toBeTruthy();
    expect(screen.getByText(/Finalizing video/)).toBeTruthy();
    expect(screen.getByText("80%")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Cancel export" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it.each(["liteCut", "montage"])("shows the dynamic NVIDIA driver warning below cancellation for %s", (variant) => {
    render(<LiteCutExportProgressDialog
      variant={variant}
      phase="running"
      result={{
        export_id: 19,
        stage: "fallback_h264_nvenc",
        progress: 0.12,
        encoder_warning: {
          code: "NVIDIA_DRIVER_TOO_OLD",
          found_nvenc_api: "13.0",
          required_nvenc_api: "13.1",
          minimum_driver_version: "610.00",
        },
      }}
      onCancel={vi.fn()}
    />);

    const cancelButton = screen.getByRole("button", { name: "Cancel export" });
    const warning = screen.getByRole("status");
    expect(cancelButton.compareDocumentPosition(warning) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByText(/encoding switched to the CPU automatically/)).toBeTruthy();
    expect(screen.getByText(/Current NVENC API 13.0, required 13.1/)).toBeTruthy();
    expect(screen.getByText(/NVIDIA driver to 610.00/)).toBeTruthy();
  });
});
