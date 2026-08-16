import { repository } from "@root/package.json";
import { getSemanticVersion } from "@/modules/stringFormatters";

export const appName = repository.url.split("/").pop();
export const appRepository = repository.url;
/**
 * Application version with build timestamp and, when the build had a git
 * repository available, the commit hash as semver build metadata.
 */
export const appVersion = [
  getSemanticVersion(VITE_BUILD_DATE_TIME),
  VITE_COMMIT_SHORT_HASH,
]
  .filter(Boolean)
  .join("+");
