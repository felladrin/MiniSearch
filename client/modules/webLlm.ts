export const webLlmModels = [
  {
    label: "Tiny (Qwen2 0.5B Instruct)",
    model_id: "mlc-q4f16_1-Qwen2-0.5B-Instruct",
    model: "https://huggingface.co/Felladrin/mlc-q4f16_1-Qwen2-0.5B-Instruct",
    model_lib:
      "https://huggingface.co/Felladrin/mlc-q4f16_1-Qwen2-0.5B-Instruct/resolve/main/model.wasm",
    overrides: {
      context_window_size: 1280,
      temperature: 0,
      frequency_penalty: 1.02,
    },
  },
  {
    label: "Small (Arcee Lite)",
    model_id: "mlc-q4f16_1-arcee-lite",
    model: "https://huggingface.co/Felladrin/mlc-q4f16_1-arcee-lite",
    model_lib:
      "https://huggingface.co/Felladrin/mlc-q4f16_1-arcee-lite/resolve/main/model.wasm",
    overrides: {
      context_window_size: 1280,
      temperature: 0,
      frequency_penalty: 1.02,
    },
  },
  {
    label: "Medium (Gemma 2 2B Instruct)",
    model_id: "mlc-q4f16_1-gemma-2-2b-it",
    model: "https://huggingface.co/Felladrin/mlc-q4f16_1-gemma-2-2b-it",
    model_lib:
      "https://huggingface.co/Felladrin/mlc-q4f16_1-gemma-2-2b-it/resolve/main/model.wasm",
    overrides: {
      context_window_size: 2048,
      temperature: 0.7,
      top_p: 0.7,
    },
  },
  {
    label: "Large (Phi 3.5 Mini Instruct)",
    model_id: "mlc-q4f16-Phi-3.5-mini-instruct",
    model: "https://huggingface.co/Felladrin/mlc-q4f16-Phi-3.5-mini-instruct",
    model_lib:
      "https://huggingface.co/Felladrin/mlc-q4f16-Phi-3.5-mini-instruct/resolve/main/model.wasm",
    overrides: {
      context_window_size: 2048,
      temperature: 0.7,
      top_p: 0.7,
    },
  },
];
