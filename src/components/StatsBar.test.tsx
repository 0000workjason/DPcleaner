import { act } from "react";
import { beforeEach, describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import type { GroupsResponse } from "../types";
import { useStore } from "../store";
import { freshStore } from "../test-utils";
import { StatsBar } from "./StatsBar";

const resetStore = freshStore();

beforeEach(() => {
  resetStore();
});

function data(): GroupsResponse {
  return {
    threshold: 0.6,
    total_files: 3,
    embedded: 3,
    groups: [
      {
        id: "g1",
        sim_min: 0.9,
        sim_max: 0.99,
        total_size: 3000,
        members: [
          {
            path: "a.png",
            name: "a.png",
            folder: "",
            ext: ".png",
            width: 1,
            height: 1,
            size: 2000,
            ctime: 0,
            mtime: 0,
          },
          {
            path: "b.png",
            name: "b.png",
            folder: "",
            ext: ".png",
            width: 1,
            height: 1,
            size: 1000,
            ctime: 0,
            mtime: 0,
          },
        ],
      },
    ],
    stats: { groups: 1, images: 2 },
  };
}

describe("StatsBar", () => {
  it("renders nothing before there is any data", () => {
    const { container } = render(<StatsBar />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows group/image counts once data is present", () => {
    act(() => useStore.setState({ data: data() }));
    render(<StatsBar />);
    expect(screen.getByText("1 groups")).toBeInTheDocument();
    expect(
      screen.getByText("2 images in duplicate groups"),
    ).toBeInTheDocument();
  });

  it("sums selected bytes and highlights the count when something is selected", () => {
    act(() =>
      useStore.setState({ data: data(), selection: new Set(["a.png"]) }),
    );
    render(<StatsBar />);
    const selected = screen.getByText(/1 selected/);
    expect(selected).toHaveTextContent("2.0 KB");
    expect(selected).toHaveClass("accent");
  });

  it("stays muted when nothing is selected", () => {
    act(() => useStore.setState({ data: data() }));
    render(<StatsBar />);
    expect(screen.getByText(/0 selected/)).toHaveClass("muted");
  });
});
