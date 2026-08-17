import { describe, expect, it } from "vitest";
import { isEditable, suppressContextMenu } from "./util";

/** A contextmenu event dispatched on `el`, plus whether it got cancelled. */
function rightClick(el: HTMLElement): boolean {
  const e = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
  el.dispatchEvent(e);
  suppressContextMenu(e);
  return e.defaultPrevented;
}

describe("suppressContextMenu", () => {
  it("cancels the native menu on ordinary elements", () => {
    expect(rightClick(document.createElement("div"))).toBe(true);
    expect(rightClick(document.createElement("img"))).toBe(true);
    // the toolbar's dropdowns are part of what the user complained about
    expect(rightClick(document.createElement("select"))).toBe(true);
  });

  // Right-click paste is the only mouse-driven way to fill in a folder path,
  // so text fields must keep the menu they own.
  it("leaves text fields alone", () => {
    expect(rightClick(document.createElement("input"))).toBe(false);
    expect(rightClick(document.createElement("textarea"))).toBe(false);
  });

  it("leaves contenteditable alone", () => {
    const el = document.createElement("div");
    // jsdom does not implement isContentEditable, so stand it in; WebView2 is
    // Chromium and does.
    Object.defineProperty(el, "isContentEditable", { value: true });
    expect(isEditable(el)).toBe(true);
    expect(rightClick(el)).toBe(false);
  });

  it("returns a real boolean even where isContentEditable is unimplemented", () => {
    expect(isEditable(document.createElement("div"))).toBe(false);
  });

  it("tolerates an event with no target", () => {
    expect(isEditable(null)).toBe(false);
    const e = new MouseEvent("contextmenu", { cancelable: true });
    expect(() => suppressContextMenu(e)).not.toThrow();
    expect(e.defaultPrevented).toBe(true);
  });
});
