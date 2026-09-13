/**
 * The pinned Moonshine model release, shared by the server hook that fetches
 * and serves the files and by the client that asks for them. One constant, so
 * a bump cannot update the route on one side and leave the other asking for a
 * version that is no longer served.
 */
export const DICTATION_MODEL_VERSION = "quantized_26_07_30";

/** Route the model files are served under, version segment included. */
export const DICTATION_MODELS_ROUTE_PREFIX = `/dictation-models/${DICTATION_MODEL_VERSION}/`;
