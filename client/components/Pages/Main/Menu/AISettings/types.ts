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
