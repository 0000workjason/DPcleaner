import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("../api", () => ({
  imgUrl: vi.fn(() => "mock://thumb"),
}));

import type { Group } from "../types";
import { useStore } from "../store";
import { freshStore } from "../test-utils";
import { GroupCard } from "./GroupCard";

const resetStore = freshStore();

beforeEach(() => {
  resetStore();
});

function makeGroup(over: Partial<Group> = {}): Group {
  return {
    id: "g1",
    sim_min: 0.9,
    sim_max: 0.99,
    total_size: 3000,
    members: [
      {
        path: "a.png",
        name: "a.png",
        folder: "C:/pics",
        ext: ".png",
        width: 100,
        height: 200,
        size: 2000,
        ctime: 0,
      },
      {
        path: "b.png",
        name: "b.png",
        folder: "C:/pics",
        ext: ".png",
        width: 100,
        height: 200,
        size: 1000,
        ctime: 0,
      },
    ],
    ...over,
  };
}

describe("GroupCard", () => {
  it("shows member count, similarity range, and total size", () => {
    render(<GroupCard group={makeGroup()} />);
    expect(screen.getByText("2 張")).toBeInTheDocument();
    expect(screen.getByText("相似度 90%–99%")).toBeInTheDocument();
    expect(screen.getByText("合計 2.9 KB")).toBeInTheDocument();
  });

  it("collapses the similarity range when min and max round to the same value", () => {
    render(<GroupCard group={makeGroup({ sim_min: 0.95, sim_max: 0.951 })} />);
    expect(screen.getByText("相似度 95%")).toBeInTheDocument();
  });

  it("clicking a tile toggles its selection", async () => {
    const user = userEvent.setup();
    render(<GroupCard group={makeGroup()} />);
    await user.click(screen.getByTitle("a.png"));
    expect(useStore.getState().selection.has("a.png")).toBe(true);
  });

  it("clicking the per-tile checkbox toggles selection exactly once", () => {
    render(<GroupCard group={makeGroup()} />);
    const checkbox = screen.getAllByRole("checkbox")[0];
    fireEvent.click(checkbox);
    expect(useStore.getState().selection.has("a.png")).toBe(true);
    fireEvent.click(checkbox);
    expect(useStore.getState().selection.has("a.png")).toBe(false);
  });

  it("select/deselect group toggles every member", async () => {
    const user = userEvent.setup();
    render(<GroupCard group={makeGroup()} />);
    await user.click(screen.getByText("全選此組"));
    expect([...useStore.getState().selection].sort()).toEqual([
      "a.png",
      "b.png",
    ]);
    await user.click(screen.getByText("取消全選"));
    expect(useStore.getState().selection.size).toBe(0);
  });

  it("compare button opens the compare viewer with all members", async () => {
    const user = userEvent.setup();
    render(<GroupCard group={makeGroup()} />);
    await user.click(screen.getByText("並排比對"));
    expect(useStore.getState().compare).toEqual(["a.png", "b.png"]);
  });

  it("right-clicking a tile opens the compare viewer for just that image", () => {
    render(<GroupCard group={makeGroup()} />);
    fireEvent.contextMenu(screen.getByTitle("b.png"));
    expect(useStore.getState().compare).toEqual(["b.png"]);
  });
});
