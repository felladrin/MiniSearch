let searchesSinceLastRestart = 0;

export function getSearchesSinceLastRestart() {
  return searchesSinceLastRestart;
}

export function incrementSearchesSinceLastRestart() {
  searchesSinceLastRestart++;
}
