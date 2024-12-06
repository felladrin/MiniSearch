import type { KeyboardEvent } from "react";

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
