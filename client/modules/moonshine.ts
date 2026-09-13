/**
 * The only module that imports `@moonshine-ai/moonshine-wasm`.
 *
 * The package is at 0.1.5 and its own README calls it a release for feedback,
 * so it is pinned exactly and funnelled through here: if it has to be replaced,
 * or swapped for `@moonshine-ai/moonshine-js`, only this file and the worker
 * change.
 */

export {
  AssetDownloader,
  ModelArch,
  Transcriber,
} from "@moonshine-ai/moonshine-wasm";
