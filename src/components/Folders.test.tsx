import { act } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("../api", () => ({
  api: {
    saveSettings: vi.fn().mockResolvedValue({ ok: true, config: {} }),
    scan: vi.fn().mockResolvedValue({ ok: true, folders: [] }),
  },
  waitForBackend: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: vi.fn(),
}));

vi.mock("@tauri-apps/api/webview", () => ({
  getCurrentWebview: vi.fn(() => ({
    onDragDropEvent: vi.fn().mockResolvedValue(vi.fn()),
  })),
}));

import { open } from "@tauri-apps/plugin-dialog";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { api } from "../api";
import { useStore } from "../store";
import { freshStore } from "../test-utils";
import { Folders } from "./Folders";

const resetStore = freshStore();

beforeEach(() => {
  resetStore();
  vi.clearAllMocks();
  vi.mocked(getCurrentWebview).mockReturnValue({
    onDragDropEvent: vi.fn().mockResolvedValue(vi.fn()),
  } as unknown as ReturnType<typeof getCurrentWebview>);
});

describe("Folders", () => {
  it("shows a placeholder and a disabled start/clear when there are no folders", () => {
    render(<Folders />);
    expect(
      screen.getByText("Click to add folders, or drag folders here"),
    ).toBeInTheDocument();
    expect(screen.getByText("Start scan")).toBeDisabled();
    expect(screen.getByText("Clear all")).toBeDisabled();
  });

  it("lists each folder and lets you remove one", async () => {
    const user = userEvent.setup();
    act(() => useStore.setState({ folders: ["C:/a", "C:/b"] }));
    render(<Folders />);
    expect(screen.getByText("C:/a")).toBeInTheDocument();
    expect(screen.getByText("C:/b")).toBeInTheDocument();

    const removeButtons = screen.getAllByText("Remove");
    await user.click(removeButtons[0]);
    expect(useStore.getState().folders).toEqual(["C:/b"]);
  });

  it("picking folders via the dialog adds them", async () => {
    const user = userEvent.setup();
    vi.mocked(open).mockResolvedValue(["C:/picked-a", "C:/picked-b"]);
    render(<Folders />);
    await user.click(screen.getByText("＋ Add folder"));
    expect(useStore.getState().folders).toEqual(["C:/picked-a", "C:/picked-b"]);
  });

  it("wraps a single picked path (string) into the folders array", async () => {
    const user = userEvent.setup();
    vi.mocked(open).mockResolvedValue("C:/picked-only");
    render(<Folders />);
    await user.click(screen.getByText("＋ Add folder"));
    expect(useStore.getState().folders).toEqual(["C:/picked-only"]);
  });

  it("dragging and dropping folders onto the window adds them", async () => {
    let dropHandler: ((e: { payload: unknown }) => void) | undefined;
    vi.mocked(getCurrentWebview).mockReturnValue({
      onDragDropEvent: vi.fn((cb) => {
        dropHandler = cb;
        return Promise.resolve(vi.fn());
      }),
    } as unknown as ReturnType<typeof getCurrentWebview>);

    render(<Folders />);
    await act(async () => {
      dropHandler?.({
        payload: { type: "drop", paths: ["C:/dropped"] },
      });
    });
    expect(useStore.getState().folders).toEqual(["C:/dropped"]);
  });

  it("clear all empties the folder list", async () => {
    const user = userEvent.setup();
    act(() => useStore.setState({ folders: ["C:/a"] }));
    render(<Folders />);
    await user.click(screen.getByText("Clear all"));
    expect(useStore.getState().folders).toEqual([]);
  });

  it("the threshold slider reflects and updates the store", () => {
    act(() => useStore.setState({ threshold: 0.75 }));
    render(<Folders />);
    expect(screen.getByText("75%")).toBeInTheDocument();
  });

  it("start scan is disabled with no folders and triggers a scan otherwise", async () => {
    const user = userEvent.setup();
    act(() => useStore.setState({ folders: ["C:/a"] }));
    render(<Folders />);
    await user.click(screen.getByText("Start scan"));
    expect(api.scan).toHaveBeenCalledWith(["C:/a"], undefined);
    expect(useStore.getState().screen).toBe("scanning");
  });

  it("rename button opens the rename dialog for that folder", async () => {
    const user = userEvent.setup();
    act(() => useStore.setState({ folders: ["C:/a"] }));
    render(<Folders />);
    await user.click(screen.getByText("Rename"));
    expect(useStore.getState().renameTarget).toBe("C:/a");
  });

  it("settings button opens the settings modal", async () => {
    const user = userEvent.setup();
    render(<Folders />);
    await user.click(screen.getByText("⚙ Settings"));
    expect(useStore.getState().settingsOpen).toBe(true);
  });
});
