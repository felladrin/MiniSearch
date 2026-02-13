/**
 * Pauses execution for a specified number of milliseconds
 * @param milliseconds - The number of milliseconds to sleep
 * @returns Promise that resolves after the specified time
 */
export async function sleep(milliseconds: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

/**
 * Yields control to the browser until the next event loop cycle
 * @returns Promise that resolves on the next tick
 */
export function sleepUntilIdle() {
  return sleep(0);
}
