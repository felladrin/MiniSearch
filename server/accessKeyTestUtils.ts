/**
 * A well-formed argon2id hash string with the client's fixed parameters
 * (m=512, t=16, p=1). The suffix makes each call unique, so the same suffix
 * is treated as the same token by the rejection cache.
 */
export function argon2idHash(suffix: string): string {
  const salt = Buffer.from(`${suffix}salt`).toString("base64url");
  const digest = Buffer.from(`${suffix}digest`).toString("base64url");
  return `$argon2id$v=19$m=512,t=16,p=1$${salt}$${digest}`;
}
