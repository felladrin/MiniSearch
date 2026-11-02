#!/usr/bin/env node
// Live check of the Wllama model catalog against HuggingFace.
//
// For every entry in client/modules/wllama.ts this HEADs every shard of the
// model (shards are derived from the `-00001-of-0000N` file name) and verifies:
//   - the file exists (HTTP 200/302)
//   - its size is plausible for the catalog's fileSizeInMegabytes claim
//
// Manual tool, not part of `npm run lint`:
//   node scripts/wllama-catalog-check.cjs
//
// Exit code 1 when any model is missing or mismatched.

const fs = require("node:fs");
const path = require("node:path");

const WLLAMA_MODULE = path.join(__dirname, "../client/modules/wllama.ts");

function parseCatalog(source) {
  const models = [];
  const entryRe =
    /"([a-z0-9.-]+)":\s*\{[\s\S]*?hfRepoId:\s*"([^"]+)",\s*hfFilePath:\s*"([^"]+)",\s*fileSizeInMegabytes:\s*(\d+)/g;
  for (const match of source.matchAll(entryRe)) {
    models.push({
      id: match[1],
      hfRepoId: match[2],
      hfFilePath: match[3],
      fileSizeInMegabytes: Number(match[4]),
    });
  }
  return models;
}

function shardUrls(hfRepoId, hfFilePath) {
  const match = hfFilePath.match(/^(.*)-(\d{5})-of-(\d{5})\.gguf$/);
  if (!match)
    return [`https://huggingface.co/${hfRepoId}/resolve/main/${hfFilePath}`];
  const [, prefix, , totalRaw] = match;
  const total = Number(totalRaw);
  const urls = [];
  for (let i = 1; i <= total; i++) {
    urls.push(
      `https://huggingface.co/${hfRepoId}/resolve/main/${prefix}-${String(i).padStart(5, "0")}-of-${totalRaw}.gguf`,
    );
  }
  return urls;
}

async function head(url) {
  const response = await fetch(url, { method: "HEAD", redirect: "follow" });
  return {
    ok: response.ok,
    status: response.status,
    length: Number(response.headers.get("content-length") ?? 0),
  };
}

async function main() {
  const source = fs.readFileSync(WLLAMA_MODULE, "utf8");
  const models = parseCatalog(source);
  if (models.length === 0) {
    console.error("no catalog entries parsed from", WLLAMA_MODULE);
    process.exit(1);
  }
  let failures = 0;
  for (const model of models) {
    const urls = shardUrls(model.hfRepoId, model.hfFilePath);
    let totalBytes = 0;
    const problems = [];
    for (const url of urls) {
      const result = await head(url);
      if (!result.ok) {
        problems.push(`HTTP ${result.status} ${url}`);
      }
      totalBytes += result.length;
    }
    const totalMegabytes = totalBytes / 1000 / 1000;
    const claimed = model.fileSizeInMegabytes;
    // The catalog rounds to whole megabytes and the claim is the model size,
    // so allow a generous 10% band; shard headers add a little on top.
    const plausible =
      totalMegabytes > claimed * 0.9 && totalMegabytes < claimed * 1.15;
    if (problems.length > 0 || !plausible) {
      failures++;
      console.error(
        `FAIL ${model.id}: ${totalMegabytes.toFixed(0)} MB on HF vs ${claimed} MB claimed`,
      );
      for (const problem of problems) console.error(`     ${problem}`);
    } else {
      console.log(
        `ok   ${model.id}: ${totalMegabytes.toFixed(0)} MB in ${urls.length} shard(s)`,
      );
    }
  }
  console.log(
    failures === 0
      ? `All ${models.length} catalog models resolve on HuggingFace.`
      : `${failures} of ${models.length} catalog models failed the check.`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
