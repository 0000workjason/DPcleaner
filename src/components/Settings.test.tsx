import { act } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("../api", () => ({
  api: {
    saveSettings: vi.fn().mockResolvedValue({ ok: true, config: {} }),
  },
  waitForBackend: vi.fn(),
}));

import { api } from "../api";
import { useStore } from "../store";
import { freshStore } from "../test-utils";
import { Settings } from "./Settings";

const resetStore = freshStore();

beforeEach(() => {
  resetStore();
  vi.clearAllMocks();
});

describe("Settings", () => {
  it("renders nothing when closed", () => {
    const { container } = render(<Settings />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows the settings form when open", () => {
    act(() => useStore.setState({ settingsOpen: true }));
    render(<Settings />);
    expect(screen.getByText("設定")).toBeInTheDocument();
  });

  it("closes when the backdrop is clicked but not when the panel is clicked", async () => {
    const user = userEvent.setup();
    act(() => useStore.setState({ settingsOpen: true }));
    render(<Settings />);
    await user.click(screen.getByText("語言")); // inside the panel
    expect(useStore.getState().settingsOpen).toBe(true);
    await user.click(screen.getByText("關閉"));
    expect(useStore.getState().settingsOpen).toBe(false);
  });

  it("changes language and persists it", async () => {
    const user = userEvent.setup();
    act(() => useStore.setState({ settingsOpen: true }));
    render(<Settings />);
    await user.selectOptions(screen.getByDisplayValue("繁體中文"), "en");
    expect(useStore.getState().lang).toBe("en");
    expect(api.saveSettings).toHaveBeenCalledWith({ lang: "en" });
  });

  it("changes theme via saveSetting", async () => {
    const user = userEvent.setup();
    act(() => useStore.setState({ settingsOpen: true }));
    render(<Settings />);
    await user.selectOptions(screen.getByDisplayValue("深色"), "light");
    expect(api.saveSettings).toHaveBeenCalledWith({ theme: "light" });
  });

  it("maps the 'auto' device option to an empty string", async () => {
    const user = userEvent.setup();
    act(() =>
      useStore.setState({ settingsOpen: true, settings: { device: "cuda" } }),
    );
    render(<Settings />);
    await user.selectOptions(screen.getByDisplayValue("GPU (cuda)"), "auto");
    expect(api.saveSettings).toHaveBeenCalledWith({ device: "" });
  });
});
