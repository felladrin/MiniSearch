/**
 * Counter for textual searches since server restart
 */
let textualSearchesSinceLastRestart = 0;
/**
 * Counter for graphical searches since server restart
 */
let graphicalSearchesSinceLastRestart = 0;

/**
 * Gets the number of textual searches since last restart
 * @returns Number of textual searches
 */
export function getTextualSearchesSinceLastRestart() {
  return textualSearchesSinceLastRestart;
}

/**
 * Increments the textual search counter
 */
export function incrementTextualSearchesSinceLastRestart() {
  textualSearchesSinceLastRestart++;
}

/**
 * Gets the number of graphical searches since last restart
 * @returns Number of graphical searches
 */
export function getGraphicalSearchesSinceLastRestart() {
  return graphicalSearchesSinceLastRestart;
}

/**
 * Increments the graphical search counter
 */
export function incrementGraphicalSearchesSinceLastRestart() {
  graphicalSearchesSinceLastRestart++;
}
