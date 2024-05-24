export function parseModelUrl(url: string) {
  const urlPartsRegex = /(.*)-(\d{5})-of-(\d{5})\.gguf$/;

  const matches = url.match(urlPartsRegex);

  if (!matches || matches.length !== 4) return url;

  const baseURL = matches[1];

  const paddedShardsAmount = matches[3];

  const paddedShardNumbers = Array.from(
    { length: Number(paddedShardsAmount) },
    (_, i) => (i + 1).toString().padStart(5, "0"),
  );

  return paddedShardNumbers.map(
    (paddedShardNumber) =>
      `${baseURL}-${paddedShardNumber}-of-${paddedShardsAmount}.gguf`,
  );
}
