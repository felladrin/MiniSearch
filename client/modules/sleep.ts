/** Pauses for the given number of milliseconds; 0 yields to the event loop. */
export async function sleep(milliseconds: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

export function sleepUntilIdle() {
  return sleep(0);
}
