import fs from "node:fs";
import path from "node:path";
import { downloadFile, fileDownloadInfo } from "@huggingface/hub";
import debug from "debug";

const printMessage = debug(path.basename(import.meta.url));
printMessage.enabled = true;

/**
 * Size the repository reports for the file, or `undefined` when the Hub cannot
 * be reached. Callers must read "unknown" as "keep whatever is cached", so a
 * warm cache still starts the server while offline.
 */
async function getRemoteFileSize(hfRepo: string, hfRepoFile: string) {
  try {
    const downloadInfo = await fileDownloadInfo({
      repo: hfRepo,
      path: hfRepoFile,
    });
    return downloadInfo?.size;
  } catch (error) {
    printMessage(
      `Could not read the metadata of ${hfRepo}/${hfRepoFile}: ${error}`,
    );
    return undefined;
  }
}

/**
 * Downloads a repository file to `localFilePath`, skipping the transfer when the
 * cached copy already matches the size the Hub reports. A cached file of the
 * wrong size is replaced instead of trusted, so a truncated model recovers on
 * the next startup rather than failing to load forever.
 */
export async function downloadFileFromHuggingFaceRepository(
  hfRepo: string,
  hfRepoFile: string,
  localFilePath: string,
): Promise<void> {
  const cachedFileSize = fs.existsSync(localFilePath)
    ? fs.statSync(localFilePath).size
    : undefined;

  const expectedFileSize = await getRemoteFileSize(hfRepo, hfRepoFile);

  if (cachedFileSize !== undefined) {
    if (expectedFileSize === undefined || cachedFileSize === expectedFileSize) {
      return;
    }

    printMessage(
      `Cached ${hfRepoFile} has ${cachedFileSize} bytes instead of ${expectedFileSize}, so it will be downloaded again.`,
    );
  }

  const downloadResponse = await downloadFile({
    repo: hfRepo,
    path: hfRepoFile,
  });

  if (!downloadResponse) {
    throw new Error(`Failed to download file from ${hfRepo}/${hfRepoFile}`);
  }

  const fileArrayBuffer = await downloadResponse.arrayBuffer();

  const fileBuffer = Buffer.from(fileArrayBuffer);

  if (
    expectedFileSize !== undefined &&
    fileBuffer.byteLength !== expectedFileSize
  ) {
    throw new Error(
      `Downloaded ${hfRepo}/${hfRepoFile} with ${fileBuffer.byteLength} bytes instead of ${expectedFileSize}`,
    );
  }

  fs.mkdirSync(path.dirname(localFilePath), { recursive: true });

  // Writing to a sibling path and renaming afterwards keeps a partial write
  // (interrupted process, full disk) from ever being visible at localFilePath,
  // where the next startup would take it for a complete file.
  const partialFilePath = `${localFilePath}.part-${process.pid}`;

  try {
    fs.writeFileSync(partialFilePath, fileBuffer);
    fs.renameSync(partialFilePath, localFilePath);
  } catch (error) {
    fs.rmSync(partialFilePath, { force: true });
    throw error;
  }
}
