const urlParams = new URLSearchParams(self.location.search);
export const debug = urlParams.has("debug");
export const beta = urlParams.has("beta");
export const query = urlParams.get("q");
export const disableWorkers = urlParams.has("disableWorkers");
