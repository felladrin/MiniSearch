declare module "http-compression" {
  import { IncomingMessage, ServerResponse } from "http";

  interface Options {
    gzip?: {
      threshold?: number;
      flush?: number;
    };
    brotli?: {
      threshold?: number;
      flush?: number;
    };
  }

  export default function compression(
    options?: Options,
  ): (req: IncomingMessage, res: ServerResponse, next: () => void) => void;
}
