import type { KeyboardEvent } from "react";

/**
 * Handles Enter key press events for form submission
 * @param event - The keyboard event from the textarea
 * @param settings - Object containing enterToSubmit setting
 * @param onSubmit - Callback function to execute when Enter key should submit
 */
export const handleEnterKeyDown = (
  event: KeyboardEvent<HTMLTextAreaElement>,
  settings: { enterToSubmit: boolean },
  onSubmit: () => void,
) => {
  // The Enter that confirms an IME composition candidate fires while the
  // composition is still in progress, so the textarea's value does not yet
  // contain the confirmed text — submitting then runs the search or sends
  // the chat message with stale or partial input. Chrome, Edge, and Firefox
  // flag the confirming keydown with isComposing; Safari reports it as
  // keyCode 229 instead, so both signals are checked.
  if (event.nativeEvent.isComposing || event.keyCode === 229) {
    return;
  }

  if (
    (event.code === "Enter" && !event.shiftKey && settings.enterToSubmit) ||
    (event.code === "Enter" && event.shiftKey && !settings.enterToSubmit)
  ) {
    event.preventDefault();
    onSubmit();
  }
};
