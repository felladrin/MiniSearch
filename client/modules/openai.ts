import OpenAI, { type ClientOptions } from "openai";

export function getOpenAiClient({
  baseURL,
  apiKey,
}: {
  baseURL: ClientOptions["baseURL"];
  apiKey: ClientOptions["apiKey"];
}) {
  return new OpenAI({
    baseURL,
    apiKey,
    dangerouslyAllowBrowser: true,
    defaultHeaders: { "X-Stainless-Retry-Count": null },
  });
}
