import { act } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useStore } from "../store";
import { freshStore } from "../test-utils";
import { Toast } from "./Toast";

const resetStore = freshStore();

beforeEach(() => {
  resetStore();
});

describe("Toast", () => {
  it("renders nothing when there is no toast", () => {
    const { container } = render(<Toast />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows the toast text when the store has one", () => {
    act(() => useStore.setState({ toast: "hello" }));
    render(<Toast />);
    expect(screen.getByText("hello")).toBeInTheDocument();
  });

  it("clears the toast when clicked", async () => {
    const user = userEvent.setup();
    act(() => useStore.setState({ toast: "hello" }));
    render(<Toast />);
    await user.click(screen.getByText("hello"));
    expect(useStore.getState().toast).toBeNull();
  });

  it("auto-dismisses after 3.5s", () => {
    vi.useFakeTimers();
    try {
      act(() => useStore.setState({ toast: "hello" }));
      render(<Toast />);
      expect(useStore.getState().toast).toBe("hello");
      act(() => {
        vi.advanceTimersByTime(3500);
      });
      expect(useStore.getState().toast).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});
