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
    expect(screen.getByText("Settings")).toBeInTheDocument();
  });

  it("closes when the backdrop is clicked but not when the panel is clicked", async () => {
    const user = userEvent.setup();
    act(() => useStore.setState({ settingsOpen: true }));
    render(<Settings />);
    await user.click(screen.getByText("Language")); // inside the panel
    expect(useStore.getState().settingsOpen).toBe(true);
    await user.click(screen.getByText("Close"));
    expect(useStore.getState().settingsOpen).toBe(false);
  });

  it("changes language and persists it", async () => {
    const user = userEvent.setup();
    act(() => useStore.setState({ settingsOpen: true }));
    render(<Settings />);
    await user.selectOptions(screen.getByDisplayValue("English"), "zh");
    expect(useStore.getState().lang).toBe("zh");
    expect(api.saveSettings).toHaveBeenCalledWith({ lang: "zh" });
  });

  it("changes theme via saveSetting", async () => {
    const user = userEvent.setup();
    act(() => useStore.setState({ settingsOpen: true }));
    render(<Settings />);
    await user.selectOptions(screen.getByDisplayValue("Dark"), "light");
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
