# Speech Model Evaluation

Why dictation runs Qwen3-ASR, why reading answers aloud still runs Piper, and which other speech models were tried and turned down. Check this page before proposing a new speech model: each candidate below was either measured or ruled out for a reason that still has to change first.

## How they were measured

On 2026-11-09, on an Apple M1 Max, in headless Chromium 151, with wllama 3.13.0, the first release that runs speech models. A throwaway page called wllama directly (it is not in the repository), so the numbers come from the same engine the app uses, with the model already loaded.

- **Dictation:** eleven clips, one sentence each in English, Portuguese, Spanish, French, German, Chinese, Japanese, Korean, Arabic, Hindi and Russian, the same languages as [wllama-model-evaluation.md](wllama-model-evaluation.md). Each clip is 2.7 to 6.4 seconds of a macOS `say` voice. Every transcript was read against the sentence.
- **Reading aloud:** one or two sentences in English, Portuguese, Spanish and Japanese, with numbers in them. Each model spoke them, and Qwen3-ASR transcribed the audio back, so a word that came out garbled shows up in the text.

## Dictation

| Model                                                         | Download            | Result                                                                                                                                              | Decision                                             |
| ------------------------------------------------------------- | ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| Qwen3-ASR 0.6B, Q4_K_M, with the Q8_0 mmproj                  | 699 MB              | All eleven languages right, apart from punctuation and small slips in Arabic and Hindi. 0.7 to 1.5 s per clip on WebGPU                             | **In use**                                           |
| Qwen3-ASR 0.6B, Q8_0, with the Q8_0 mmproj                    | 1019 MB             | The same, with smaller slips in Arabic and Hindi. 0.6 to 1.6 s per clip on WebGPU; 4.0 to 7.4 s on the CPU, 1.0 to 1.3 times the length of the clip | Not worth the extra 320 MB                           |
| LFM3-Omni 2B, Q4_0, with the Q4_0 mmproj                      | 1320 MB             | Right in eight languages. Korean misheard "한라산" as "할라산", Arabic came out wrong, and Hindi came back romanized                                | Rejected: twice the download for a worse transcript  |
| Voxtral Mini 3B and 4B Realtime, Q4_K_M, with the Q8_0 mmproj | 3189 MB and 3615 MB | Not run                                                                                                                                             | Rejected: 4.6 to 5.2 times the download of Qwen3-ASR |
| Parakeet TDT 0.6B v3 (`ggml-org/parakeet-GGUF`)               | 356 MB at Q4_0      | Not run: the files are `.bin` conversions for whisper.cpp, which wllama cannot load                                                                 | Rejected until a llama.cpp conversion exists         |
| Moonshine Tiny Streaming (`@moonshine-ai/moonshine-wasm`)     | 51 MB               | English only                                                                                                                                        | Replaced by Qwen3-ASR                                |

Qwen3-ASR replaced Moonshine for three reasons. It understands every language MiniSearch answers in, where Moonshine understood English only, so a non-English browser no longer has to send its audio to the browser vendor. It runs in wllama, which the app already ships for the chat models, so the 13 MB Moonshine runtime left the build. And the model now comes from Hugging Face like the chat models, so the server no longer proxies and caches model files.

What it cost:

- **The download.** About 700 MB on the first press, against Moonshine's 51 MB.
- **Live text.** Qwen3-ASR has no streaming transcription in wllama 3.13.0 (`has_live_asr` is false), so the text appears when the user stops, not while they speak. In the app, a short query landed in the field 1.4 to 2.2 seconds after the user stopped, on WebGPU.
- **A two-minute cap.** The whole recording goes to the model at once, so it has to fit the context; the recording ends on its own at two minutes.

## Reading aloud

| Model                                                  | Download                         | Result                                                                                                                                                                                                                                                                          | Decision                                              |
| ------------------------------------------------------ | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| Piper medium voices (`@diffusionstudio/vits-web`)      | 63 MB a voice                    | 2.5 to 2.9 s for 6.0 to 7.7 s of audio, so about 0.4 times real time. The round trip got English exactly; Portuguese lost "Eiffel" ("torre Felt") and Spanish turned "y" into "en"                                                                                              | **Kept**                                              |
| LFM3-Omni 2B, Q4_0, with the Q4_0 mmproj               | 1320 MB                          | 10 to 16 s for 7 to 11 s of audio, about 1.5 times real time. The round trip broke the numbers: 1889 became "eight hundred and nine" in English, the Portuguese sentence ended in "antes de Zeus", 1914 became "mil ochocientos" in Spanish, and the Japanese came back garbled | Rejected: slower than real time, and it changes facts |
| Qwen3-TTS 12Hz 1.7B Base, Q4_K_M, with the Q8_0 mmproj | 1482 MB                          | 23 to 26 s for about 7 s of audio, 3.4 to 3.5 times real time. English came back right and Portuguese nearly ("torre é felta"). The third and fourth calls in a row failed with `Invalid magic number`                                                                          | Rejected: far slower than real time, and the failure  |
| Pocket TTS GGUF conversions                            | 62 to 138 MB, plus a voices file | Not run: they target pockettts.cpp rather than llama.cpp, and cover English and a few European languages                                                                                                                                                                        | Rejected: fewer languages than Piper                  |

Piper stays because it speaks faster than real time, which matters for a feature that reads a whole answer, and because both models wllama runs made the result worse. LFM3-Omni changed numbers, and an answer that reads a wrong year aloud is worse than none. Qwen3-TTS takes three times as long as the audio it makes, and needs a download 23 times the size of a Piper voice.

## What would reopen this

- A dictation model with live text in wllama (`has_live_asr`) and the same language coverage, which would bring back the text appearing while the user speaks.
- A smaller Qwen3-ASR quant that keeps the eleven languages right; the Q4_K_M weights are most of the download.
- A text-to-speech model that runs faster than real time on the CPU in wllama, in more languages than Piper, and keeps numbers intact in the round trip.

## Related topics

- **Text-to-speech and dictation in the app:** [ai-integration.md](ai-integration.md#text-to-speech)
- **Where the audio goes:** [security.md](security.md)
- **How the chat models are scored:** [wllama-model-evaluation.md](wllama-model-evaluation.md)
