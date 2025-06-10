export interface ModelOption {
  label: string;
  value: string;
}

export interface HordeUserInfo {
  username: string;
  kudos: number;
}

export interface AIParameterSliderProps extends Record<string, unknown> {
  label: string;
  description: string;
  defaultValue: number;
}
