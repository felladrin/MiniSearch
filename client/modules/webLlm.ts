export const webLlmModels = [
  {
    label: "Small (Qwen2 0.5B Instruct)",
    model_id: "mlc-q4f16_1-Qwen2-0.5B-Instruct",
    model: "https://huggingface.co/Felladrin/mlc-q4f16_1-Qwen2-0.5B-Instruct",
    model_lib:
      "https://huggingface.co/Felladrin/mlc-q4f16_1-Qwen2-0.5B-Instruct/resolve/main/model.wasm",
    overrides: {
      context_window_size: 2048,
      temperature: 0,
      frequency_penalty: 1.02,
    },
  },
  {
    label: "Medium (Arcee Lite)",
    model_id: "mlc-q0f16-arcee-lite",
    model: "https://huggingface.co/Felladrin/mlc-q0f16-arcee-lite",
    model_lib:
      "https://huggingface.co/Felladrin/mlc-q0f16-arcee-lite/resolve/main/model.wasm",
    overrides: {
      context_window_size: 2048,
      temperature: 0,
      frequency_penalty: 1.02,
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
