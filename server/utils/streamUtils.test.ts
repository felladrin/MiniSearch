import { describe, expect, it, vi } from "vitest";
import { readCappedBytes } from "./streamUtils";

function fakeResponse(chunks: Uint8Array[]) {
  let index = 0;
  const cancel = vi.fn().mockResolvedValue(undefined);
  const reader = {
    read: vi.fn(async () => {
      if (index < chunks.length) {
        return { done: false, value: chunks[index++] };
      }
      return { done: true, value: undefined };
    }),
    cancel,
  };
  const response = {
    body: {
      getReader: () => reader,
    },
  } as unknown as Response;
  return { response, reader, cancel };
}

describe("readCappedBytes", () => {
  it.each([
    {
      title: "reads an exact-fit body in a single chunk",
      chunks: [[1, 2, 3, 4]],
      bytes: [1, 2, 3, 4],
      truncated: false,
    },
    {
      title: "reads an exact-fit body split across chunks",
      chunks: [
        [1, 2],
        [3, 4],
      ],
      bytes: [1, 2, 3, 4],
      truncated: false,
    },
    {
      title: "truncates when a single chunk exceeds maxBytes",
      chunks: [[1, 2, 3, 4, 5]],
      bytes: [1, 2, 3, 4],
      truncated: true,
    },
    {
      title: "truncates when the boundary lands on a chunk boundary",
      chunks: [[1, 2, 3, 4], [5]],
      bytes: [1, 2, 3, 4],
      truncated: true,
    },
  ])("$title", async ({ chunks, bytes, truncated }) => {
    const { response, cancel } = fakeResponse(
      chunks.map((chunk) => new Uint8Array(chunk)),
    );
    const result = await readCappedBytes(response, 4);

    expect(Array.from(result.bytes)).toEqual(bytes);
    expect(result.truncated).toBe(truncated);
    expect(cancel).toHaveBeenCalled();
  });

  it("returns all bytes and truncated false when body is under cap", async () => {
    const { response, cancel } = fakeResponse([new Uint8Array([1, 2, 3])]);
    const { bytes, truncated } = await readCappedBytes(response, 10);

    expect(Array.from(bytes)).toEqual([1, 2, 3]);
    expect(truncated).toBe(false);
    expect(cancel).toHaveBeenCalled();
  });

  it("returns empty buffer and truncated false for an empty body", async () => {
    const { response, cancel } = fakeResponse([]);
    const { bytes, truncated } = await readCappedBytes(response, 10);

    expect(bytes.byteLength).toBe(0);
    expect(truncated).toBe(false);
    expect(cancel).toHaveBeenCalled();
  });

  it("returns empty buffer and truncated false when response has no body", async () => {
    const { bytes, truncated } = await readCappedBytes({} as Response, 10);

    expect(bytes.byteLength).toBe(0);
    expect(truncated).toBe(false);
  });

  it("cancels reader even if an error occurs during reading", async () => {
    const cancel = vi.fn().mockResolvedValue(undefined);
    const reader = {
      read: vi.fn().mockRejectedValue(new Error("network failure")),
      cancel,
    };
    const response = {
      body: {
        getReader: () => reader,
      },
    } as unknown as Response;

    await expect(readCappedBytes(response, 10)).rejects.toThrow(
      "network failure",
    );
    expect(cancel).toHaveBeenCalled();
  });
});
