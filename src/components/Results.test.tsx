import { act } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("../api", () => ({
  api: {
    saveSettings: vi.fn().mockResolvedValue({ ok: true, config: {} }),
    trash: vi.fn().mockResolvedValue({ ok: [], failed: [] }),
    undo: vi.fn().mockResolvedValue({ restored: [], failed: [], remaining: 0 }),
    groups: vi.fn(),
  },
  imgUrl: vi.fn(() => "mock://thumb"),
  waitForBackend: vi.fn(),
}));

import type { GroupsResponse } from "../types";
import { useStore } from "../store";
import { freshStore } from "../test-utils";
import { Results } from "./Results";

const resetStore = freshStore();

beforeEach(() => {
  resetStore();
});

function member(path: string, ctime: number) {
  return {
    path,
    name: path,
    folder: "",
    ext: ".png",
    width: 1,
    height: 1,
    size: 1,
    ctime,
  };
}

function dataWith(groups: GroupsResponse["groups"]): GroupsResponse {
  const images = groups.reduce((n, g) => n + g.members.length, 0);
  return {
    threshold: 0.6,
    total_files: images,
    embedded: images,
    groups,
    stats: { groups: groups.length, images },
  };
}

describe("Results", () => {
  it("back button returns to the folders screen", async () => {
    const user = userEvent.setup();
    act(() => useStore.setState({ data: dataWith([]), screen: "results" }));
    render(<Results />);
    await user.click(screen.getByText("← Back"));
    expect(useStore.getState().screen).toBe("folders");
  });

  it("shows the no-duplicates message when there are no groups at all", () => {
    act(() => useStore.setState({ data: dataWith([]) }));
    render(<Results />);
    expect(
      screen.getByText("No duplicates found — try lowering the threshold."),
    ).toBeInTheDocument();
  });

  it("shows the no-match message when filters exclude every group", () => {
    act(() =>
      useStore.setState({
        data: dataWith([
          {
            id: "g1",
            sim_min: 0.9,
            sim_max: 0.9,
            total_size: 0,
            members: [member("a.png", 1), member("b.png", 2)],
          },
        ]),
        view: { sortBy: "ctime", search: "", ext: "", minGroup: 5 },
      }),
    );
    render(<Results />);
    expect(
      screen.getByText("No groups match the current filters."),
    ).toBeInTheDocument();
  });

  it("renders one card per visible group, newest-first by default", () => {
    act(() =>
      useStore.setState({
        data: dataWith([
          {
            id: "older",
            sim_min: 0.9,
            sim_max: 0.9,
            total_size: 0,
            members: [member("old1.png", 1), member("old2.png", 1)],
          },
          {
            id: "newer",
            sim_min: 0.9,
            sim_max: 0.9,
            total_size: 0,
            members: [
              member("new1.png", 100),
              member("new2.png", 100),
              member("new3.png", 100),
            ],
          },
        ]),
      }),
    );
    render(<Results />);
    const names = screen
      .getAllByText(/^\d images$/)
      .map((el) => el.textContent);
    expect(names).toEqual(["3 images", "2 images"]); // newer (3 members) sorts first
  });
});
