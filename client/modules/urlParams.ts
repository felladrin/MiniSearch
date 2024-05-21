const urlParams = new URLSearchParams(self.location.search);
export const debug = urlParams.has("debug");
export const query = urlParams.get("q");
