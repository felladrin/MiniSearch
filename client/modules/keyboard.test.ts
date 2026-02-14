import type { KeyboardEvent } from "react";
import { describe, expect, it, vi } from "vitest";
import { handleEnterKeyDown } from "./keyboard";

function mockEvent(shift: boolean): Partial<KeyboardEvent> {
  return {
    code: "Enter",
    shiftKey: shift,
    preventDefault: vi.fn(),
  } as Partial<KeyboardEvent>;
}

describe("handleEnterKeyDown", () => {
  it("submits when Enter without Shift and enterToSubmit true", () => {
    const onSubmit = vi.fn();
    const event = mockEvent(false);
    handleEnterKeyDown(
      event as KeyboardEvent<HTMLTextAreaElement>,
      { enterToSubmit: true },
      onSubmit,
    );
    expect(event.preventDefault).toHaveBeenCalled();
    expect(onSubmit).toHaveBeenCalled();
  });

  it("does not submit when Enter without Shift and enterToSubmit false", () => {
    const onSubmit = vi.fn();
    const event = mockEvent(false);
    handleEnterKeyDown(
      event as KeyboardEvent<HTMLTextAreaElement>,
      { enterToSubmit: false },
      onSubmit,
    );
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("submits when Shift+Enter and enterToSubmit false", () => {
    const onSubmit = vi.fn();
    const event = mockEvent(true);
    handleEnterKeyDown(
      event as KeyboardEvent<HTMLTextAreaElement>,
      { enterToSubmit: false },
      onSubmit,
    );
    expect(event.preventDefault).toHaveBeenCalled();
    expect(onSubmit).toHaveBeenCalled();
  });

  it("does not submit when Shift+Enter and enterToSubmit true", () => {
    const onSubmit = vi.fn();
    const event = mockEvent(true);
    handleEnterKeyDown(
      event as KeyboardEvent<HTMLTextAreaElement>,
      { enterToSubmit: true },
      onSubmit,
    );
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
