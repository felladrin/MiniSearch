import { repository } from "@root/package.json";
import { getSemanticVersion } from "@/modules/stringFormatters";

/**
 * Application name extracted from repository URL
 */
export const appName = repository.url.split("/").pop();
/**
 * Full repository URL
 */
export const appRepository = repository.url;
/**
 * Application version with build timestamp and commit hash
 */
export const appVersion = `${getSemanticVersion(VITE_BUILD_DATE_TIME)}+${VITE_COMMIT_SHORT_HASH}`;
