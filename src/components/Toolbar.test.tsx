import { act } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("../api", () => ({
  api: {
    saveSettings: vi.fn().mockResolvedValue({ ok: true, config: {} }),
  },
  waitForBackend: vi.fn(),
}));

import type { GroupsResponse } from "../types";
import { useStore } from "../store";
import { freshStore } from "../test-utils";
import { Toolbar } from "./Toolbar";

const resetStore = freshStore();

beforeEach(() => {
  resetStore();
});

function data(exts: string[]): GroupsResponse {
  return {
    threshold: 0.6,
    total_files: exts.length,
    embedded: exts.length,
    groups: [
      {
        id: "g1",
        sim_min: 0.9,
        sim_max: 0.99,
        total_size: 0,
        members: exts.map((ext, i) => ({
          path: `${i}${ext}`,
          name: `${i}${ext}`,
          folder: "",
          ext,
          width: 1,
          height: 1,
          size: 1,
          ctime: 0,
          mtime: 0,
        })),
      },
    ],
    stats: { groups: 1, images: exts.length },
  };
}

describe("Toolbar", () => {
  it("shows the current threshold as a percentage", () => {
    act(() => useStore.setState({ threshold: 0.72 }));
    render(<Toolbar />);
    expect(screen.getByText("72%")).toBeInTheDocument();
  });

  it("dragging the threshold slider updates the store", async () => {
    render(<Toolbar />);
    fireSlider(screen.getByRole("slider"), "0.8");
    expect(useStore.getState().threshold).toBeCloseTo(0.8);
  });

  it("typing in the search box updates view.search", async () => {
    const user = userEvent.setup();
    render(<Toolbar />);
    await user.type(screen.getByPlaceholderText("Search filename…"), "cat");
    expect(useStore.getState().view.search).toBe("cat");
  });

  it("lists the distinct extensions found in the current data", () => {
    act(() => useStore.setState({ data: data([".jpg", ".png", ".jpg"]) }));
    render(<Toolbar />);
    const extSelect = screen.getByText("All formats").closest("select")!;
    const options = [...extSelect.options].map((o) => o.value);
    expect(options.sort()).toEqual(["", ".jpg", ".png"]);
  });

  it("opens settings when the settings button is clicked", async () => {
    const user = userEvent.setup();
    render(<Toolbar />);
    await user.click(screen.getByTitle("Settings"));
    expect(useStore.getState().settingsOpen).toBe(true);
  });

  it("enforces a minimum group size of 2", () => {
    render(<Toolbar />);
    const input = screen.getByDisplayValue("2");
    fireEvent.change(input, { target: { value: "1" } });
    expect(useStore.getState().view.minGroup).toBe(2);
  });
});

// jsdom's range inputs don't reliably fire onChange via fireEvent.change, so
// drive the native value setter + input event directly (React listens on
// "input" for range/text controls).
function fireSlider(el: HTMLElement, value: string) {
  const input = el as HTMLInputElement;
  const setter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    "value",
  )!.set!;
  act(() => {
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
