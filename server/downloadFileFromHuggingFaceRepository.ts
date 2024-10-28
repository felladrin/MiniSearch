import fs from "node:fs";
import path from "node:path";
import { downloadFile } from "@huggingface/hub";

export async function downloadFileFromHuggingFaceRepository(
  hfRepo: string,
  hfRepoFile: string,
  localFilePath: string,
): Promise<void> {
  if (fs.existsSync(localFilePath)) return;

  const downloadResponse = await downloadFile({
    repo: hfRepo,
    path: hfRepoFile,
  });

  if (!downloadResponse) {
    throw new Error(`Failed to download file from ${hfRepo}/${hfRepoFile}`);
  }

  const fileArrayBuffer = await downloadResponse.arrayBuffer();

  const fileBuffer = Buffer.from(fileArrayBuffer);

  const fileDirectory = path.dirname(localFilePath);

  if (!fs.existsSync(fileDirectory)) {
    fs.mkdirSync(fileDirectory, { recursive: true });
  }

  fs.writeFileSync(localFilePath, fileBuffer);
}
