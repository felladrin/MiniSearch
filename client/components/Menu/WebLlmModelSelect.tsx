import { ComboboxData, Select } from "@mantine/core";
import { useState, useEffect } from "react";
import { isF16Supported } from "../../modules/webGpu";

export default function WebLlmModelSelect({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const [webGpuModels, setWebGpuModels] = useState<ComboboxData>([]);

  useEffect(() => {
    async function loadWebGpuModels() {
      const { prebuiltAppConfig } = await import("@mlc-ai/web-llm");

      const suffix = isF16Supported ? "-q4f16_1-MLC" : "-q4f32_1-MLC";

      const models = prebuiltAppConfig.model_list
        .filter((model) => model.model_id.endsWith(suffix))
        .sort((a, b) => (a.vram_required_MB ?? 0) - (b.vram_required_MB ?? 0))
        .map((model) => ({
          label: `${model.model_id.replace(suffix, "")} • ${Math.round(model.vram_required_MB ?? 0) || "N/A"} MB`,
          value: model.model_id,
        }));

      setWebGpuModels(models);

      const isCurrentModelValid = models.some((model) => model.value === value);

      if (!isCurrentModelValid && models.length > 0) {
        onChange(models[0].value);
      }
    }

    loadWebGpuModels();
  }, [value, onChange]);

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
    />
  );
}
