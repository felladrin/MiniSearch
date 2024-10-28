import { type ComboboxItem, Select } from "@mantine/core";
import { prebuiltAppConfig } from "@mlc-ai/web-llm";
import { useEffect, useState } from "react";
import { isF16Supported } from "../../modules/webGpu";

export default function WebLlmModelSelect({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const [webGpuModels] = useState<ComboboxItem[]>(() => {
    const suffix = isF16Supported ? "-q4f16_1-MLC" : "-q4f32_1-MLC";

    const models = prebuiltAppConfig.model_list
      .filter((model) => model.model_id.endsWith(suffix))
      .sort((a, b) => (a.vram_required_MB ?? 0) - (b.vram_required_MB ?? 0))
      .map((model) => ({
        label: `${Math.round(model.vram_required_MB ?? 0) || "N/A"} MB • ${model.model_id.replace(suffix, "")}`,
        value: model.model_id,
      }));

    return models;
  });

  useEffect(() => {
    const isCurrentModelValid = webGpuModels.some(
      (model) => model.value === value,
    );

    if (!isCurrentModelValid && webGpuModels.length > 0) {
      onChange(webGpuModels[0].value);
    }
  }, [onChange, webGpuModels, value]);

  const handleChange = (value: string | null) => {
    if (value) onChange(value);
  };

  return (
    <Select
      value={value}
      onChange={handleChange}
      label="AI Model"
      description="Select the model to use for AI responses."
      data={webGpuModels}
      allowDeselect={false}
      searchable
    />
  );
}
