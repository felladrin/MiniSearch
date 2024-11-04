import { type ComboboxItem, Select } from "@mantine/core";
import { prebuiltAppConfig } from "@mlc-ai/web-llm";
import { useCallback, useEffect, useState } from "react";
import { isF16Supported } from "../../modules/webGpu";

export default function WebLlmModelSelect({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const [webGpuModels] = useState<ComboboxItem[]>(() => {
    const models = prebuiltAppConfig.model_list
      .filter((model) => {
        const isSmall = isSmallModel(model);
        const suffix = getModelSuffix(isF16Supported, isSmall);
        return model.model_id.endsWith(suffix);
      })
      .sort((a, b) => (a.vram_required_MB ?? 0) - (b.vram_required_MB ?? 0))
      .map((model) => {
        const modelSizeInMegabytes =
          Math.round(model.vram_required_MB ?? 0) || "N/A";
        const isSmall = isSmallModel(model);
        const suffix = getModelSuffix(isF16Supported, isSmall);
        const modelName = model.model_id.replace(suffix, "");

        return {
          label: `${modelSizeInMegabytes} MB • ${modelName}`,
          value: model.model_id,
        };
      });

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

  const handleChange = useCallback(
    (value: string | null) => {
      if (value) onChange(value);
    },
    [onChange],
  );

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

type ModelConfig = (typeof prebuiltAppConfig.model_list)[number];

const smallModels = ["SmolLM2-135M", "SmolLM2-360M"] as const;

function isSmallModel(model: ModelConfig) {
  return smallModels.some((smallModel) =>
    model.model_id.startsWith(smallModel),
  );
}

function getModelSuffix(isF16: boolean, isSmall: boolean) {
  if (isSmall) return isF16 ? "-q0f16-MLC" : "-q0f32-MLC";

  return isF16 ? "-q4f16_1-MLC" : "-q4f32_1-MLC";
}
