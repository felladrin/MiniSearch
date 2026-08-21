declare module "pdf-parse" {
  export default function pdfParse(
    data: Uint8Array,
  ): Promise<{ text: string; info: Record<string, unknown> }>;
}
