const urlParams = new URLSearchParams(window.location.search);
export const debug = urlParams.has("debug");
export const query = urlParams.get("q");
export const disableWorkers = urlParams.has("disableWorkers");
