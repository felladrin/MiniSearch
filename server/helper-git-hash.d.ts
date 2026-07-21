declare module "helper-git-hash" {
  interface GitHashOptions {
    short?: boolean;
    cwd?: string;
  }
  export default function gitHash(options?: GitHashOptions): string;
}
