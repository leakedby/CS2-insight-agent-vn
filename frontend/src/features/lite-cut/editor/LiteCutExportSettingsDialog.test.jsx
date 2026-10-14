/** @vitest-environment jsdom */
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import LiteCutExportSettingsDialog from "./LiteCutExportSettingsDialog.jsx";

describe("LiteCutExportSettingsDialog", () => {
  it("opens the export settings as a centered modal", () => {
    render(
      <LiteCutExportSettingsDialog open onClose={vi.fn()}>
        <div>export settings content</div>
      </LiteCutExportSettingsDialog>,
    );

    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(screen.getByText("export settings content")).toBeTruthy();
  });

  it("closes from the header action and Escape", () => {
    const onClose = vi.fn();
    render(
      <LiteCutExportSettingsDialog open onClose={onClose}>
        <div>content</div>
      </LiteCutExportSettingsDialog>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Close export settings" }));
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
