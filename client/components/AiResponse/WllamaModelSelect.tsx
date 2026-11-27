import { type ComboboxItem, Select } from "@mantine/core";
import { useCallback, useEffect, useState } from "react";
import { getDownloadedWllamaModelIds, wllamaModels } from "@/modules/wllama";

export default function WllamaModelSelect({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const [wllamaModelOptions] = useState<ComboboxItem[]>(
    Object.entries(wllamaModels)
      .sort(([, a], [, b]) => a.fileSizeInMegabytes - b.fileSizeInMegabytes)
      .map(([value, { label, fileSizeInMegabytes }]) => ({
        label: `${fileSizeInMegabytes} MB • ${label}`,
        value,
      })),
  );
  const [downloadedModelIds, setDownloadedModelIds] = useState<Set<string>>(
    () => new Set(),
  );

  const refreshDownloadedModelIds = useCallback(() => {
    getDownloadedWllamaModelIds().then(setDownloadedModelIds);
  }, []);

  useEffect(() => {
    refreshDownloadedModelIds();
  }, [refreshDownloadedModelIds]);

  useEffect(() => {
    const isCurrentModelValid = wllamaModelOptions.some(
      (model) => model.value === value,
    );

    if (!isCurrentModelValid && wllamaModelOptions.length > 0) {
      onChange(wllamaModelOptions[0].value);
    }
  }, [onChange, wllamaModelOptions, value]);

  const modelOptions = wllamaModelOptions.map((option) =>
    downloadedModelIds.has(option.value)
      ? { ...option, label: `${option.label} • Downloaded` }
      : option,
  );

  return (
    <Select
      value={value}
      onChange={(value) => value && onChange(value)}
      label="AI Model"
      description="Select the model to use for AI responses."
      data={modelOptions}
      allowDeselect={false}
      searchable
      onDropdownOpen={refreshDownloadedModelIds}
    />
  );
}
