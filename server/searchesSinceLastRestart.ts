let textualSearchesSinceLastRestart = 0;
let graphicalSearchesSinceLastRestart = 0;

export function getTextualSearchesSinceLastRestart() {
  return textualSearchesSinceLastRestart;
}

export function incrementTextualSearchesSinceLastRestart() {
  textualSearchesSinceLastRestart++;
}

export function getGraphicalSearchesSinceLastRestart() {
  return graphicalSearchesSinceLastRestart;
}

export function incrementGraphicalSearchesSinceLastRestart() {
  graphicalSearchesSinceLastRestart++;
}
