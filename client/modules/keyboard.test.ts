import type { KeyboardEvent } from "react";
import { describe, expect, it, vi } from "vitest";
import { handleEnterKeyDown } from "./keyboard";

function mockEvent(
  shift: boolean,
): Partial<KeyboardEvent<HTMLTextAreaElement>> {
  return {
    code: "Enter",
    shiftKey: shift,
    keyCode: 13,
    preventDefault: vi.fn(),
    nativeEvent: { isComposing: false },
  } as unknown as Partial<KeyboardEvent<HTMLTextAreaElement>>;
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

  it("does not submit when Enter confirms an IME composition candidate", () => {
    const onSubmit = vi.fn();
    const event = {
      ...mockEvent(false),
      nativeEvent: { isComposing: true },
    };
    handleEnterKeyDown(
      event as KeyboardEvent<HTMLTextAreaElement>,
      { enterToSubmit: true },
      onSubmit,
    );
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("does not submit when the composition is only flagged by keyCode 229", () => {
    const onSubmit = vi.fn();
    const event = {
      ...mockEvent(false),
      keyCode: 229,
    };
    handleEnterKeyDown(
      event as KeyboardEvent<HTMLTextAreaElement>,
      { enterToSubmit: true },
      onSubmit,
    );
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("still submits a normal Enter after a composition has ended", () => {
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
});
