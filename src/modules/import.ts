/** Prevents Vite from transpiling the imported module. */
export async function importModuleWithoutTranspilation<T = void>(
  path: string,
): Promise<T> {
  return import(
    /* @vite-ignore */
    path
  );
}
