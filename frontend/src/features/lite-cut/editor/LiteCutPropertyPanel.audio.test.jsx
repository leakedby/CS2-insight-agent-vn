/** @vitest-environment jsdom */
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import LiteCutPropertyPanel, { AudioPane } from "./LiteCutPropertyPanel.jsx";

describe("LiteCut audio inspector", () => {
  it("separates global BGM, video-track gain, and per-clip source volume", () => {
    render(<AudioPane trackLabel="V1" onTrackVolumeChange={() => {}} />);

    expect(screen.getByText("Project BGM (global)")).toBeTruthy();
    expect(screen.getByText("Doesn't use an audio track (A)")).toBeTruthy();
    expect(screen.getByText("Video track audio gain")).toBeTruthy();
    expect(screen.getByText(/clip volume × video track gain × project volume/)).toBeTruthy();
    expect(screen.queryByText("Keep video audio")).toBeNull();
  });

  it("keeps A-track and selected audio-clip controls when an audio clip is selected", () => {
    render(<AudioPane isAudioClip trackLabel="A1" onTrackVolumeChange={() => {}} />);

    expect(screen.getByText("Audio track (A) gain")).toBeTruthy();
    expect(screen.getByText("Audio track (A) clip")).toBeTruthy();
    expect(screen.getByText(/both are mixed together on export/)).toBeTruthy();
  });

  it("exposes video source-volume keyframes beside the editable volume", () => {
    const onAdd = vi.fn();
    render(
      <AudioPane
        trackLabel="V1"
        onTrackVolumeChange={() => {}}
        onAddClipAudioKeyframe={onAdd}
      />,
    );

    expect(screen.getByText("Clip audio volume (%)")).toBeTruthy();
    expect(screen.getByText("Volume keyframe")).toBeTruthy();
    expect(screen.getByText(/add a keyframe, then adjust the clip volume above/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Add Volume keyframe at playhead" }));
    expect(onAdd).toHaveBeenCalledTimes(1);
  });

  it("routes A-track volume changes through the keyframe-aware volume callback", () => {
    const onVolumeChange = vi.fn();
    const onAudioPatch = vi.fn();
    render(
      <AudioPane
        isAudioClip
        volume={1}
        onVolumeChange={onVolumeChange}
        onAudioPatch={onAudioPatch}
      />,
    );

    const volumeRow = screen.getByText("Clip volume (%)").closest(".litecut-property-control-row");
    fireEvent.change(volumeRow.querySelector("input"), { target: { value: "35" } });
    expect(onVolumeChange).toHaveBeenCalledWith(0.35);
    expect(onAudioPatch).not.toHaveBeenCalled();
  });

  it("unmutes an A-track clip instead of only changing its volume", () => {
    const onVolumeChange = vi.fn();
    const onAudioPatch = vi.fn();
    render(
      <AudioPane
        isAudioClip
        muted
        volume={0.8}
        onVolumeChange={onVolumeChange}
        onAudioPatch={onAudioPatch}
      />,
    );

    fireEvent.click(screen.getByRole("switch"));
    expect(onAudioPatch).toHaveBeenCalledWith({ muted: false });
    expect(onVolumeChange).not.toHaveBeenCalled();
  });

  it("renders the resolved A-track target while the selected timeline clip is video", () => {
    const { container } = render(
      <LiteCutPropertyPanel
        defaultTab="audio"
        selectedMedia={{ id: "video", kind: "video", title: "video.mp4" }}
        isAudioClip={false}
        audioTargetIsAudioClip
        selectedClipLabel="linked-audio.wav"
      />,
    );

    expect(screen.getByText("Audio track (A) clip")).toBeTruthy();
    expect(screen.getByText("linked-audio.wav")).toBeTruthy();
    const tabs = container.querySelector("[data-litecut-inspector-tabs]");
    expect(tabs.className).toContain("grid-cols-6");
    expect(tabs.querySelectorAll("button")).toHaveLength(6);
  });

  it("keeps BGM start positions beyond the old 60-second UI ceiling", () => {
    const onBgmChange = vi.fn();
    render(
      <AudioPane
        bgm={{ path: "C:/music/theme.mp3", start_sec: 120, volume: 1 }}
        timelineTotalSec={180}
        onBgmChange={onBgmChange}
      />,
    );

    const startRow = screen.getByText("Start time (s)").closest(".litecut-property-control-row");
    const input = startRow.querySelector("input");
    expect(input.value).toBe("120");
    expect(input.max).toBe("180");
    fireEvent.change(input, { target: { value: "150" } });
    expect(onBgmChange).toHaveBeenCalledWith(expect.objectContaining({ start_sec: 150 }));
  });
});
