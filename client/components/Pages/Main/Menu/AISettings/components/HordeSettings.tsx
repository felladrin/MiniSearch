import { Select, TextInput } from "@mantine/core";
import type { UseFormReturnType } from "@mantine/form";
import type { defaultSettings } from "@/modules/settings";
import { aiHordeDefaultApiKey } from "@/modules/textGenerationWithHorde";
import type { HordeUserInfo, ModelOption } from "../types";

/**
 * Props for the HordeSettings component
 */
interface HordeSettingsProps {
  /** Form instance for managing Horde AI settings */
  form: UseFormReturnType<typeof defaultSettings>;
  /** User information from AI Horde, or null if not logged in */
  hordeUserInfo: HordeUserInfo | null;
  /** Available models from AI Horde */
  hordeModels: ModelOption[];
}

/**
 * Component for managing AI Horde settings.
 * Provides controls for API key input and model selection.
 */
export const HordeSettings = ({
  form,
  hordeUserInfo,
  hordeModels,
}: HordeSettingsProps) => (
  <>
    <TextInput
      label="API Key"
      description={
        hordeUserInfo
          ? `Logged in as ${
              hordeUserInfo.username
            } (${hordeUserInfo.kudos.toLocaleString()} kudos)`
          : "By default, it's set to '0000000000', for anonymous access. However, anonymous accounts have the lowest priority when there's too many concurrent requests."
      }
      type="password"
      {...form.getInputProps("hordeApiKey")}
    />
    {form.values.hordeApiKey.length > 0 &&
      form.values.hordeApiKey !== aiHordeDefaultApiKey && (
        <Select
          label="Model"
          description="Optional. When not selected, AI Horde will automatically choose an available model."
          placeholder="Auto-selected"
          data={hordeModels}
          {...form.getInputProps("hordeModel")}
          searchable
          clearable
        />
      )}
  </>
);
