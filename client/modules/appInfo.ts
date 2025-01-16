import { repository } from "../../package.json";
import { getSemanticVersion } from "./stringFormatters";

export const appName = repository.url.split("/").pop();
export const appRepository = repository.url;
export const appVersion = `${getSemanticVersion(VITE_BUILD_DATE_TIME)}+${VITE_COMMIT_SHORT_HASH}`;
