/**
 * A `Response` for the search services' tests: the body is a string, and the
 * fields the services read are the only ones filled in.
 */
export function mockResponse(
  body: string,
  {
    status,
    ok = status === undefined ? true : status >= 200 && status < 300,
    headers = {},
    contentType,
    unreadBody = null,
  }: {
    ok?: boolean;
    status?: number;
    headers?: Record<string, string>;
    /** Omitted leaves the `content-type` header off, as a headerless reply. */
    contentType?: string;
    /** The `body` the service sees, so a test can watch its reader cancel. */
    unreadBody?: { cancel: () => Promise<void> } | null;
  } = {},
): Response {
  const resolvedStatus = status ?? (ok ? 200 : 503);
  return {
    ok,
    status: resolvedStatus,
    statusText: ok ? "OK" : "Error",
    headers: new Headers(
      contentType === undefined
        ? headers
        : { "content-type": contentType, ...headers },
    ),
    redirected: false,
    type: "basic" as ResponseType,
    url: "http://test.com",
    clone: function () {
      return this;
    },
    body: unreadBody,
    bodyUsed: false,
    arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
    blob: () => Promise.resolve(new Blob()),
    formData: () => Promise.resolve(new FormData()),
    json: () => Promise.resolve(JSON.parse(body)),
    text: () => Promise.resolve(body),
  } as unknown as Response;
}
