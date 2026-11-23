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
  it("reads an exact-fit body in a single chunk without truncation", async () => {
    const { response, cancel } = fakeResponse([new Uint8Array([1, 2, 3, 4])]);
    const { bytes, truncated } = await readCappedBytes(response, 4);

    expect(Array.from(bytes)).toEqual([1, 2, 3, 4]);
    expect(truncated).toBe(false);
    expect(cancel).toHaveBeenCalled();
  });

  it("reads an exact-fit body split across chunks without truncation", async () => {
    const { response, cancel } = fakeResponse([
      new Uint8Array([1, 2]),
      new Uint8Array([3, 4]),
    ]);
    const { bytes, truncated } = await readCappedBytes(response, 4);

    expect(Array.from(bytes)).toEqual([1, 2, 3, 4]);
    expect(truncated).toBe(false);
    expect(cancel).toHaveBeenCalled();
  });

  it("truncates at the cap when a single chunk exceeds maxBytes", async () => {
    const { response, cancel } = fakeResponse([
      new Uint8Array([1, 2, 3, 4, 5]),
    ]);
    const { bytes, truncated } = await readCappedBytes(response, 4);

    expect(Array.from(bytes)).toEqual([1, 2, 3, 4]);
    expect(truncated).toBe(true);
    expect(cancel).toHaveBeenCalled();
  });

  it("truncates at the cap when the boundary lands on a chunk boundary", async () => {
    const { response, cancel } = fakeResponse([
      new Uint8Array([1, 2, 3, 4]),
      new Uint8Array([5]),
    ]);
    const { bytes, truncated } = await readCappedBytes(response, 4);

    expect(Array.from(bytes)).toEqual([1, 2, 3, 4]);
    expect(truncated).toBe(true);
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
