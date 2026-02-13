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
  if (
    (event.code === "Enter" && !event.shiftKey && settings.enterToSubmit) ||
    (event.code === "Enter" && event.shiftKey && !settings.enterToSubmit)
  ) {
    event.preventDefault();
    onSubmit();
  }
};
