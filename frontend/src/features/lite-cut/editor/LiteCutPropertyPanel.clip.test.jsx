/** @vitest-environment jsdom */
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ClipPane } from "./LiteCutPropertyPanel.jsx";

describe("LiteCut clip keyframe inspector", () => {
  it("shows hard cut as the default when no transition event exists", () => {
    render(<ClipPane media={{ id: "clip-cut", title: "demo.mp4", kind: "video", duration: 5 }} isVideoLayer />);

    fireEvent.click(screen.getByRole("button", { name: "Transitions" }));
    expect(screen.getByRole("button", { name: /\bCut$/ }).className).toContain("text-cs2-accent");
    expect(screen.getByRole("button", { name: /\bFade$/ }).className).not.toContain("text-cs2-accent");
  });

  it("shows editable transform keyframes beside their parameters", () => {
    const onAdd = vi.fn();
    render(
      <ClipPane
        media={{ id: "clip-1", title: "demo.mp4", kind: "video", duration: 5 }}
        isVideoLayer
        clipTransform={{ x: 0.5, y: 0.5, width: 1, height: 1, scale: 1, rotation: 0, opacity: 1 }}
        onClipTransformChange={() => {}}
        onAddClipKeyframe={onAdd}
      />,
    );

    expect(screen.getByText("Transform & visual keyframes")).toBeTruthy();
    expect(screen.getByText("Visual keyframe")).toBeTruthy();
    expect(screen.getByText(/position, size, scale, rotation or opacity/)).toBeTruthy();
    expect(screen.getByText("Position (px)")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Add Visual keyframe at playhead" }));
    expect(onAdd).toHaveBeenCalledTimes(1);
  });

  it("makes the current keyframe state explicit", () => {
    render(
      <ClipPane
        media={{ id: "clip-2", title: "demo.mp4", kind: "video", duration: 5 }}
        isVideoLayer
        clipHasKeyframe
        clipTransform={{ x: 0.5, y: 0.5, width: 1, height: 1, scale: 1, rotation: 0, opacity: 1 }}
        onClipTransformChange={() => {}}
      />,
    );

    expect(screen.getByText(/There's a keyframe at the playhead/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Delete current Visual keyframe" }).disabled).toBe(false);
  });
});
