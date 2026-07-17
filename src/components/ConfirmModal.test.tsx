import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ConfirmModal } from "./ConfirmModal";

describe("ConfirmModal", () => {
  it("renders nothing when closed", () => {
    const { container } = render(
      <ConfirmModal
        open={false}
        title="t"
        message="m"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("shows title and message when open", () => {
    render(
      <ConfirmModal
        open
        title="Delete these?"
        message="This cannot be undone"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByText("Delete these?")).toBeInTheDocument();
    expect(screen.getByText("This cannot be undone")).toBeInTheDocument();
  });

  it("calls onCancel when the backdrop or cancel button is clicked", async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();
    render(
      <ConfirmModal
        open
        title="t"
        message="m"
        onConfirm={vi.fn()}
        onCancel={onCancel}
      />,
    );
    await user.click(screen.getByText("取消"));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("does not close when clicking inside the modal body", async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();
    render(
      <ConfirmModal
        open
        title="Delete these?"
        message="m"
        onConfirm={vi.fn()}
        onCancel={onCancel}
      />,
    );
    await user.click(screen.getByText("Delete these?"));
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("calls onConfirm and uses a custom confirm label when given", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(
      <ConfirmModal
        open
        title="t"
        message="m"
        confirmLabel="Yes, delete"
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />,
    );
    await user.click(screen.getByText("Yes, delete"));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("applies the danger class when danger is true", () => {
    render(
      <ConfirmModal
        open
        danger
        title="t"
        message="m"
        confirmLabel="Go"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByText("Go")).toHaveClass("danger");
  });
});
