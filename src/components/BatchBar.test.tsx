import { act } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("../api", () => ({
  api: {
    trash: vi.fn().mockResolvedValue({ ok: [], failed: [] }),
    undo: vi.fn().mockResolvedValue({ restored: [], failed: [], remaining: 0 }),
    groups: vi.fn().mockResolvedValue({
      threshold: 0.6,
      total_files: 0,
      embedded: 0,
      groups: [],
      stats: { groups: 0, images: 0 },
    }),
  },
  waitForBackend: vi.fn(),
}));

import { api } from "../api";
import { useStore } from "../store";
import { freshStore } from "../test-utils";
import { BatchBar } from "./BatchBar";

const resetStore = freshStore();

beforeEach(() => {
  resetStore();
  vi.clearAllMocks();
});

describe("BatchBar", () => {
  it("disables clear/undo/trash when there is nothing to act on", () => {
    render(<BatchBar />);
    expect(screen.getByText("Clear selection")).toBeDisabled();
    expect(screen.getByText("↩ Undo")).toBeDisabled();
    expect(screen.getByText("Move to Recycle Bin（0）")).toBeDisabled();
  });

  it("enables clear/trash and shows the selection count", () => {
    act(() => useStore.setState({ selection: new Set(["a.png", "b.png"]) }));
    render(<BatchBar />);
    expect(screen.getByText("Clear selection")).toBeEnabled();
    expect(screen.getByText("Move to Recycle Bin（2）")).toBeEnabled();
  });

  it("shows the undo count once there is something to undo", () => {
    act(() => useStore.setState({ undoCount: 3 }));
    render(<BatchBar />);
    expect(screen.getByText("↩ Undo（3）")).toBeEnabled();
  });

  it("disables everything while busy", () => {
    act(() =>
      useStore.setState({
        busy: true,
        selection: new Set(["a.png"]),
        undoCount: 1,
      }),
    );
    render(<BatchBar />);
    expect(screen.getByText("Select all")).toBeDisabled();
    expect(screen.getByText("Clear selection")).toBeDisabled();
    expect(screen.getByText(/↩ Undo/)).toBeDisabled();
    expect(screen.getByText(/Move to Recycle Bin/)).toBeDisabled();
  });

  it("clicking trash opens a confirmation, and cancelling does nothing", async () => {
    const user = userEvent.setup();
    act(() => useStore.setState({ selection: new Set(["a.png"]) }));
    render(<BatchBar />);
    await user.click(screen.getByText("Move to Recycle Bin（1）"));
    expect(screen.getByText("Move to Recycle Bin")).toBeInTheDocument();
    await user.click(screen.getByText("Cancel"));
    expect(api.trash).not.toHaveBeenCalled();
  });

  it("confirming the trash prompt actually trashes the selection", async () => {
    const user = userEvent.setup();
    act(() => useStore.setState({ selection: new Set(["a.png"]) }));
    render(<BatchBar />);
    await user.click(screen.getByText("Move to Recycle Bin（1）"));
    await user.click(screen.getByRole("button", { name: "Move to bin" }));
    expect(api.trash).toHaveBeenCalledWith(["a.png"]);
  });

  it("clicking undo calls the store's undo action", async () => {
    const user = userEvent.setup();
    act(() => useStore.setState({ undoCount: 1 }));
    render(<BatchBar />);
    await user.click(screen.getByText("↩ Undo（1）"));
    expect(api.undo).toHaveBeenCalledTimes(1);
  });
});
