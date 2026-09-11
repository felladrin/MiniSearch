/**
 * The only module that imports `@diffusionstudio/vits-web`.
 *
 * The package is thin (a handful of commits) and pins `onnxruntime-web` at
 * 1.18.0, so it may have to be swapped for our own onnxruntime-web setup one
 * day. Funnelling every import through this file keeps that a one-file change.
 */

export type { Voice, VoiceId } from "@diffusionstudio/vits-web";
export { predict, voices } from "@diffusionstudio/vits-web";
