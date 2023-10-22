/// <reference types="vite/client" />

declare module "loadbar" {
  export default class Loadbar {
    constructor(
      options?: {
        height?: string;
        backgroundColor?: string;
        easeFunction?: function;
        zIndex?: number;
        startPoint?: number;
        pausePoint?: number;
      },
      el?: HTMLElement,
    );
    growTo(num: number): void;
    start(): void;
    loading(): void;
    pause(): this;
    stop(): void;
    destroy(): void;
    done(): void;
  }
}
