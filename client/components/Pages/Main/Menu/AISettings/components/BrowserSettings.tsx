import { NumberInput, Skeleton, Switch } from "@mantine/core";
import type { UseFormReturnType } from "@mantine/form";
import { lazy, Suspense } from "react";
import type { defaultSettings } from "../../../../../../modules/settings";

const WebLlmModelSelect = lazy(
  () => import("../../../../../../components/AiResponse/WebLlmModelSelect"),
);
const WllamaModelSelect = lazy(
  () => import("../../../../../../components/AiResponse/WllamaModelSelect"),
);

interface BrowserSettingsProps {
  form: UseFormReturnType<typeof defaultSettings>;
  isWebGPUAvailable: boolean;
}

export const BrowserSettings = ({
  form,
  isWebGPUAvailable,
}: BrowserSettingsProps) => (
  <>
    {isWebGPUAvailable && (
      <Switch
        label="WebGPU"
        {...form.getInputProps("enableWebGpu", { type: "checkbox" })}
        labelPosition="left"
        description="Enable or disable WebGPU usage. When disabled, the app will use the CPU instead."
      />
    )}

    {isWebGPUAvailable && form.values.enableWebGpu ? (
      <Suspense fallback={<Skeleton height={50} />}>
        <WebLlmModelSelect
          value={form.values.webLlmModelId}
          onChange={(value: string) =>
            form.setFieldValue("webLlmModelId", value)
          }
        />
      </Suspense>
    ) : (
      <>
        <Suspense fallback={<Skeleton height={50} />}>
          <WllamaModelSelect
            value={form.values.wllamaModelId}
            onChange={(value: string) =>
              form.setFieldValue("wllamaModelId", value)
            }
          />
        </Suspense>
        <NumberInput
          label="CPU threads to use"
          description="Number of threads to use for the AI model. Lower values will use less CPU but may take longer to respond. A value that is too high may cause the app to hang."
          min={1}
          {...form.getInputProps("cpuThreads")}
        />
      </>
    )}
  </>
);
