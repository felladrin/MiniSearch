import type { UseFormReturnType } from "@mantine/form";
import type { defaultSettings } from "../../../../../modules/settings";

export interface ModelOption {
  label: string;
  value: string;
}

export interface HordeUserInfo {
  username: string;
  kudos: number;
}

export interface AISettingsFormProps {
  form: UseFormReturnType<typeof defaultSettings>;
}

export interface AIParameterSliderProps extends Record<string, unknown> {
  label: string;
  description: string;
  defaultValue: number;
}

export const penaltySliderMarks = [
  { value: -2.0, label: "-2.0" },
  { value: 0.0, label: "0" },
  { value: 2.0, label: "2.0" },
];
