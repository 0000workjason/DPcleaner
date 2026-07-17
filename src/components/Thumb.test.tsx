import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

vi.mock("../api", () => ({
  imgUrl: vi.fn((path: string, size = 320) => `mock://${path}?size=${size}`),
}));

import { Thumb } from "./Thumb";

describe("Thumb", () => {
  it("renders an image with the backend thumbnail URL", () => {
    render(<Thumb path="C:/pics/a.png" />);
    const img = screen.getByRole("img");
    expect(img.getAttribute("src")).toBe("mock://C:/pics/a.png?size=320");
    expect(img.getAttribute("alt")).toBe("C:/pics/a.png");
  });

  it("uses the given alt text when provided", () => {
    render(<Thumb path="C:/pics/a.png" alt="a thumbnail" />);
    expect(screen.getByRole("img").getAttribute("alt")).toBe("a thumbnail");
  });

  it("falls back to a text message when the image fails to load", () => {
    render(<Thumb path="C:/pics/a.png" />);
    fireEvent.error(screen.getByRole("img"));
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(screen.getByText("無法預覽")).toBeInTheDocument();
  });
});
