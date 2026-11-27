/**
 * The `enterToSubmit` matrix: the setting, the key, and whether the key sends.
 * Shared by the search form and the chat input, which read the same setting.
 */
export const ENTER_TO_SUBMIT_CASES: [boolean, string, boolean][] = [
  [true, "{Enter}", true],
  [true, "{Shift>}{Enter}{/Shift}", false],
  [false, "{Shift>}{Enter}{/Shift}", true],
  [false, "{Enter}", false],
];
