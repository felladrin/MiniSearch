import { repository, version } from "../package.json" with { type: "json" };

const appName = repository.url.slice(repository.url.lastIndexOf("/") + 1);

/**
 * How the server identifies itself on its outbound requests to third
 * parties: name, version and where to read about it. Some hosts refuse a
 * request that carries no User-Agent; upload.wikimedia.org answers it with
 * 403.
 */
export const OUTBOUND_USER_AGENT = `Mozilla/5.0 (compatible; ${appName}/${version}; +${repository.url})`;
