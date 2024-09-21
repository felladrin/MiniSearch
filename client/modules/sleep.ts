export async function sleep(milliseconds: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

export async function sleepUntilIdle() {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}
