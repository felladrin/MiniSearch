import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { downloadFile, fileDownloadInfo } from "@huggingface/hub";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { downloadFileFromHuggingFaceRepository } from "./downloadFileFromHuggingFaceRepository";

vi.mock("@huggingface/hub", () => ({
  downloadFile: vi.fn(),
  fileDownloadInfo: vi.fn(),
}));

const REPO = "jinaai/jina-reranker-v1-tiny-en";
const REPO_FILE = "onnx/model.onnx";
const REMOTE_CONTENT = "complete model bytes";

let temporaryDirectory: string;
let localFilePath: string;

function serveRemoteFile(content = REMOTE_CONTENT) {
  vi.mocked(fileDownloadInfo).mockResolvedValue({
    size: Buffer.byteLength(REMOTE_CONTENT),
    etag: "etag",
    url: `https://huggingface.co/${REPO}/resolve/main/${REPO_FILE}`,
  });
  vi.mocked(downloadFile).mockImplementation(async () => new Blob([content]));
}

function download(filePath = localFilePath) {
  return downloadFileFromHuggingFaceRepository(REPO, REPO_FILE, filePath);
}

function listDirectory(directory = path.dirname(localFilePath)) {
  return fs.existsSync(directory) ? fs.readdirSync(directory).sort() : [];
}

beforeEach(() => {
  vi.clearAllMocks();
  temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "hf-download-"));
  localFilePath = path.join(temporaryDirectory, "onnx", "model.onnx");
});

afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(temporaryDirectory, { recursive: true, force: true });
});

describe("downloadFileFromHuggingFaceRepository", () => {
  it("downloads a file that is not cached yet", async () => {
    serveRemoteFile();

    await download();

    expect(fs.readFileSync(localFilePath, "utf8")).toBe(REMOTE_CONTENT);
    expect(listDirectory()).toEqual(["model.onnx"]);
  });

  it("keeps a cached file whose size matches the repository", async () => {
    serveRemoteFile();
    fs.mkdirSync(path.dirname(localFilePath), { recursive: true });
    fs.writeFileSync(localFilePath, REMOTE_CONTENT);

    await download();

    expect(downloadFile).not.toHaveBeenCalled();
  });

  it("only downloads the missing file when a sibling is already cached", async () => {
    serveRemoteFile();
    const cachedFilePath = path.join(temporaryDirectory, "tokenizer.json");
    fs.writeFileSync(cachedFilePath, REMOTE_CONTENT);

    await download(cachedFilePath);
    await download();

    expect(downloadFile).toHaveBeenCalledTimes(1);
    expect(fs.readFileSync(localFilePath, "utf8")).toBe(REMOTE_CONTENT);
  });

  it("replaces a truncated cached file instead of trusting it", async () => {
    serveRemoteFile();
    fs.mkdirSync(path.dirname(localFilePath), { recursive: true });
    fs.writeFileSync(localFilePath, REMOTE_CONTENT.slice(0, 5));

    await download();

    expect(downloadFile).toHaveBeenCalledTimes(1);
    expect(fs.readFileSync(localFilePath, "utf8")).toBe(REMOTE_CONTENT);
  });

  it("keeps a cached file when the repository metadata is unreachable", async () => {
    vi.mocked(fileDownloadInfo).mockRejectedValue(new Error("offline"));
    fs.mkdirSync(path.dirname(localFilePath), { recursive: true });
    fs.writeFileSync(localFilePath, REMOTE_CONTENT.slice(0, 5));

    await download();

    expect(downloadFile).not.toHaveBeenCalled();
    expect(fs.readFileSync(localFilePath, "utf8")).toBe(
      REMOTE_CONTENT.slice(0, 5),
    );
  });

  it("writes nothing when the response is shorter than the expected size", async () => {
    serveRemoteFile("truncated");

    await expect(download()).rejects.toThrow(/9 bytes instead of 20/);

    expect(listDirectory()).toEqual([]);
  });

  it("leaves no partial file behind when the disk fills up mid-write", async () => {
    serveRemoteFile();
    vi.spyOn(fs, "writeFileSync").mockImplementation((filePath) => {
      const fileDescriptor = fs.openSync(filePath as string, "w");
      fs.writeSync(fileDescriptor, REMOTE_CONTENT.slice(0, 5));
      fs.closeSync(fileDescriptor);
      throw new Error("ENOSPC: no space left on device");
    });

    await expect(download()).rejects.toThrow("ENOSPC");

    expect(listDirectory()).toEqual([]);
  });
});
