import { act } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("../api", () => ({
  api: {
    cancelScan: vi.fn().mockResolvedValue({ ok: true }),
  },
  waitForBackend: vi.fn(),
}));

const closeMock = vi.fn();
vi.mock("../ws", () => ({
  openProgress: vi.fn(() => ({ close: closeMock })),
}));

import { openProgress } from "../ws";
import { api } from "../api";
import { useStore } from "../store";
import { freshStore } from "../test-utils";
import { Scanning } from "./Scanning";

const resetStore = freshStore();

beforeEach(() => {
  resetStore();
  vi.clearAllMocks();
});

describe("Scanning", () => {
  it("opens a progress connection on mount and closes it on unmount", () => {
    const { unmount } = render(<Scanning />);
    expect(openProgress).toHaveBeenCalledTimes(1);
    expect(closeMock).not.toHaveBeenCalled();
    unmount();
    expect(closeMock).toHaveBeenCalledTimes(1);
  });

  it("shows the idle/preparing label at 0% before anything is reported", () => {
    render(<Scanning />);
    expect(screen.getByText("0%")).toBeInTheDocument();
    expect(screen.getByText("準備中…")).toBeInTheDocument();
  });

  it("shows scanning / embedding (with counts) / grouping labels", () => {
    render(<Scanning />);

    act(() =>
      useStore.getState().setProgress({
        phase: "scanning",
        done: 0,
        total: 0,
        status: "",
        error: "",
      }),
    );
    expect(screen.getByText("掃描資料夾中…")).toBeInTheDocument();

    act(() =>
      useStore.getState().setProgress({
        phase: "embedding",
        done: 3,
        total: 10,
        status: "",
        error: "",
      }),
    );
    expect(screen.getByText("計算特徵中 3/10")).toBeInTheDocument();
    expect(screen.getByText("30%")).toBeInTheDocument();

    act(() =>
      useStore.getState().setProgress({
        phase: "grouping",
        done: 10,
        total: 10,
        status: "",
        error: "",
      }),
    );
    expect(screen.getByText("比對中…")).toBeInTheDocument();
    expect(screen.getByText("100%")).toBeInTheDocument();
  });

  it("stop button cancels the scan", async () => {
    const user = userEvent.setup();
    render(<Scanning />);
    await user.click(screen.getByText("停止"));
    expect(api.cancelScan).toHaveBeenCalledTimes(1);
  });
});
