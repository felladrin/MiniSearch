/**
 * Represents a model option for select components
 */
export interface ModelOption {
  /** Display label for the model */
  label: string;
  /** Internal value for the model */
  value: string;
}

/**
 * Represents user information from AI Horde
 */
export interface HordeUserInfo {
  /** Username of the Horde user */
  username: string;
  /** Number of kudos (credits) the user has */
  kudos: number;
}

/**
 * Props for AI parameter slider components
 */
export interface AIParameterSliderProps extends Record<string, unknown> {
  /** Label for the slider */
  label: string;
  /** Description for the slider */
  description: string;
  /** Default value for the slider */
  defaultValue: number;
}
