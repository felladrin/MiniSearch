import { type ComboboxItem, Select } from "@mantine/core";
import { useEffect, useState } from "react";
import { wllamaModels } from "../../modules/wllama";

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

  useEffect(() => {
    const isCurrentModelValid = wllamaModelOptions.some(
      (model) => model.value === value,
    );

    if (!isCurrentModelValid && wllamaModelOptions.length > 0) {
      onChange(wllamaModelOptions[0].value);
    }
  }, [onChange, wllamaModelOptions, value]);

  return (
    <Select
      value={value}
      onChange={(value) => value && onChange(value)}
      label="AI Model"
      description="Select the model to use for AI responses."
      data={wllamaModelOptions}
      allowDeselect={false}
      searchable
    />
  );
}
