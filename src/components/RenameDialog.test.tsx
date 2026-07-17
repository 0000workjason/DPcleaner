import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

vi.mock("../api", () => ({
  api: {
    renamePreview: vi.fn(),
    renameApply: vi.fn(),
    renameUndo: vi.fn(),
  },
  waitForBackend: vi.fn(),
}));

import { api } from "../api";
import { useStore } from "../store";
import { freshStore } from "../test-utils";
import { RenameDialog } from "./RenameDialog";

const resetStore = freshStore();

async function tick(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

async function click(el: HTMLElement) {
  await act(async () => {
    fireEvent.click(el);
  });
}

beforeEach(() => {
  resetStore();
  vi.clearAllMocks();
  vi.mocked(api.renamePreview).mockResolvedValue({
    items: [],
    count: 0,
    conflicts: [],
  });
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("RenameDialog", () => {
  it("renders nothing without a rename target", () => {
    const { container } = render(<RenameDialog />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows the target folder once opened", () => {
    act(() => useStore.setState({ renameTarget: "C:/pics" }));
    render(<RenameDialog />);
    expect(screen.getByText(/C:\/pics/)).toBeInTheDocument();
  });

  it("fetches and shows a debounced preview", async () => {
    vi.mocked(api.renamePreview).mockResolvedValue({
      items: [
        { old: "C:/pics/img10.jpg", new: "C:/pics/1.jpg" },
        { old: "C:/pics/img2.jpg", new: "C:/pics/2.jpg" },
      ],
      count: 2,
      conflicts: [],
    });
    act(() => useStore.setState({ renameTarget: "C:/pics" }));
    render(<RenameDialog />);

    expect(api.renamePreview).not.toHaveBeenCalled();
    await tick(180);

    expect(api.renamePreview).toHaveBeenCalledWith(
      expect.objectContaining({ folder: "C:/pics", order: "date", start: 1 }),
    );
    expect(screen.getByText("img10.jpg")).toBeInTheDocument();
    expect(screen.getByText("1.jpg")).toBeInTheDocument();
  });

  it("shows a message when the folder has no images", async () => {
    act(() => useStore.setState({ renameTarget: "C:/pics" }));
    render(<RenameDialog />);
    await tick(180);
    expect(screen.getByText("這個資料夾沒有圖片檔。")).toBeInTheDocument();
  });

  it("warns about naming conflicts", async () => {
    vi.mocked(api.renamePreview).mockResolvedValue({
      items: [{ old: "a.jpg", new: "1.jpg" }],
      count: 1,
      conflicts: ["1.jpg"],
    });
    act(() => useStore.setState({ renameTarget: "C:/pics" }));
    render(<RenameDialog />);
    await tick(180);
    expect(
      screen.getByText("1 個目標檔名已被其他檔案占用，將略過不覆蓋。"),
    ).toBeInTheDocument();
  });

  it("re-fetches the preview (debounced) when the form changes", async () => {
    act(() => useStore.setState({ renameTarget: "C:/pics" }));
    render(<RenameDialog />);
    await tick(180);
    expect(api.renamePreview).toHaveBeenCalledTimes(1);

    fireEvent.change(screen.getByPlaceholderText("自動"), {
      target: { value: "9" },
    });
    await tick(180);

    expect(api.renamePreview).toHaveBeenCalledTimes(2);
    const calls = vi.mocked(api.renamePreview).mock.calls;
    const lastCall = calls[calls.length - 1][0];
    expect(lastCall.pad).toBe(9);
  });

  it("applying a successful rename shows the done view with an undo button", async () => {
    vi.mocked(api.renameApply).mockResolvedValue({
      ok: [{ old: "a.jpg", new: "1.jpg" }],
      failed: [],
      batch_id: "batch1",
      renamed: 1,
    });
    vi.mocked(api.renamePreview).mockResolvedValue({
      items: [{ old: "a.jpg", new: "1.jpg" }],
      count: 1,
      conflicts: [],
    });
    act(() => useStore.setState({ renameTarget: "C:/pics" }));
    render(<RenameDialog />);
    await tick(180);

    await click(screen.getByText("套用"));
    expect(screen.getByText("已重新命名 1 個檔案。")).toBeInTheDocument();
    expect(useStore.getState().toast).toBeNull();
  });

  it("applying with nothing to rename shows a toast and stays on the form", async () => {
    vi.mocked(api.renameApply).mockResolvedValue({
      ok: [],
      failed: [],
      batch_id: "",
      renamed: 0,
    });
    vi.mocked(api.renamePreview).mockResolvedValue({
      items: [{ old: "a.jpg", new: "1.jpg" }],
      count: 1,
      conflicts: [],
    });
    act(() => useStore.setState({ renameTarget: "C:/pics" }));
    render(<RenameDialog />);
    await tick(180);

    await click(screen.getByText("套用"));
    expect(useStore.getState().toast).toBe("沒有需要重新命名的檔案");
    expect(screen.queryByText("完成")).not.toBeInTheDocument();
  });

  it("shows an error toast when apply throws", async () => {
    vi.mocked(api.renameApply).mockRejectedValue(new Error("locked"));
    vi.mocked(api.renamePreview).mockResolvedValue({
      items: [{ old: "a.jpg", new: "1.jpg" }],
      count: 1,
      conflicts: [],
    });
    act(() => useStore.setState({ renameTarget: "C:/pics" }));
    render(<RenameDialog />);
    await tick(180);

    await click(screen.getByText("套用"));
    expect(useStore.getState().toast).toContain("locked");
  });

  it("undo calls the API, toasts, and closes the dialog", async () => {
    vi.mocked(api.renameApply).mockResolvedValue({
      ok: [{ old: "a.jpg", new: "1.jpg" }],
      failed: [],
      batch_id: "batch1",
      renamed: 1,
    });
    vi.mocked(api.renameUndo).mockResolvedValue({
      restored: [{ old: "a.jpg", new: "1.jpg" }],
      failed: [],
      ok: true,
    });
    vi.mocked(api.renamePreview).mockResolvedValue({
      items: [{ old: "a.jpg", new: "1.jpg" }],
      count: 1,
      conflicts: [],
    });
    act(() => useStore.setState({ renameTarget: "C:/pics" }));
    render(<RenameDialog />);
    await tick(180);

    await click(screen.getByText("套用"));
    await click(screen.getByText("↩ 復原這次命名"));

    expect(api.renameUndo).toHaveBeenCalledWith("batch1");
    expect(useStore.getState().toast).toBe("已復原這次命名");
    expect(useStore.getState().renameTarget).toBeNull();
  });

  it("close button clears the rename target", async () => {
    act(() => useStore.setState({ renameTarget: "C:/pics" }));
    render(<RenameDialog />);
    await tick(180);
    await click(screen.getByText("取消"));
    expect(useStore.getState().renameTarget).toBeNull();
  });
});
