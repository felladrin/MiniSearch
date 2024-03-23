/** Server headers for cross origin isolation, which enable clients to use `SharedArrayBuffer` on the Browser. */
export const crossOriginIsolationHeaders: { key: string; value: string }[] = [
  {
    key: "Cross-Origin-Embedder-Policy",
    value: "require-corp",
  },
  {
    key: "Cross-Origin-Opener-Policy",
    value: "same-origin",
  },
  {
    key: "Cross-Origin-Resource-Policy",
    value: "cross-origin",
  },
];
