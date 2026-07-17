import { act } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("../api", () => ({
  imgUrl: vi.fn((path: string) => `mock://${path}`),
}));

import { useStore } from "../store";
import { freshStore } from "../test-utils";
import { CompareViewer } from "./CompareViewer";

const resetStore = freshStore();

beforeEach(() => {
  resetStore();
});

describe("CompareViewer", () => {
  it("renders nothing when there is nothing to compare", () => {
    const { container } = render(<CompareViewer />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows one pane per path with its basename", () => {
    act(() =>
      useStore.setState({ compare: ["C:/pics/a.png", "C:/pics/b.png"] }),
    );
    render(<CompareViewer />);
    expect(screen.getByText("a.png")).toBeInTheDocument();
    expect(screen.getByText("b.png")).toBeInTheDocument();
    expect(
      screen.getByText(
        "2 張並排 · 滾輪縮放 · 拖曳平移 · 0 重置 · 右鍵/Esc 關閉",
      ),
    ).toBeInTheDocument();
  });

  it("close button clears the compare state", async () => {
    const user = userEvent.setup();
    act(() => useStore.setState({ compare: ["a.png"] }));
    render(<CompareViewer />);
    await user.click(screen.getByText("關閉 ✕"));
    expect(useStore.getState().compare).toBeNull();
  });

  it("Escape key closes the viewer", () => {
    act(() => useStore.setState({ compare: ["a.png"] }));
    render(<CompareViewer />);
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(useStore.getState().compare).toBeNull();
  });

  it("scrolling zooms in, and both the reset button and '0' key reset it", () => {
    act(() => useStore.setState({ compare: ["a.png"] }));
    const { container } = render(<CompareViewer />);
    const row = container.querySelector(".compare-row")!;
    const img = () => container.querySelector(".compare-img") as HTMLElement;

    expect(img().style.transform).toBe("translate(0px, 0px) scale(1)");
    act(() => {
      fireEvent.wheel(row, { deltaY: -100 });
    });
    expect(img().style.transform).toBe("translate(0px, 0px) scale(1.15)");

    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "0" }));
    });
    expect(img().style.transform).toBe("translate(0px, 0px) scale(1)");
  });

  it("right-clicking the backdrop closes the viewer", () => {
    act(() => useStore.setState({ compare: ["a.png"] }));
    const { container } = render(<CompareViewer />);
    fireEvent.contextMenu(container.querySelector(".compare-backdrop")!);
    expect(useStore.getState().compare).toBeNull();
  });
});
