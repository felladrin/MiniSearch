import { NumberInput, Skeleton } from "@mantine/core";
import type { UseFormReturnType } from "@mantine/form";
import { lazy, Suspense } from "react";
import type { defaultSettings } from "@/modules/settings";

const WllamaModelSelect = lazy(
  () => import("@/components/AiResponse/WllamaModelSelect"),
);

/**
 * Props for the BrowserSettings component
 */
interface BrowserSettingsProps {
  /** Form instance for managing browser AI settings */
  form: UseFormReturnType<typeof defaultSettings>;
}

/**
 * Component for managing browser-based AI settings.
 * Provides controls for model selection and CPU thread configuration.
 */
export const BrowserSettings = ({ form }: BrowserSettingsProps) => (
  <>
    <Suspense fallback={<Skeleton height={50} />}>
      <WllamaModelSelect
        value={form.values.wllamaModelId}
        onChange={(value: string) => form.setFieldValue("wllamaModelId", value)}
      />
    </Suspense>
    <NumberInput
      label="CPU threads to use"
      description="Number of threads to use for the AI model. Lower values will use less CPU but may take longer to respond. A value that is too high may cause the app to hang."
      min={1}
      {...form.getInputProps("cpuThreads")}
    />
  </>
);
