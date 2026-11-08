# Wllama Model Evaluation

How the in-browser models in `client/modules/wllama.ts` are measured, and how they scored.

## What it measures

MiniSearch's own task, not a general benchmark. `npm run bench:wllama` (see [development-commands.md](development-commands.md#wllama-benchmark)) loads each model in headless Chromium through the app's code: the catalog entry, `initializeWllama`, and the chat messages that `getFormattedSearchResults` and `getDefaultChatMessages` build from the default system prompt (`shared/defaultSystemPrompt.ts`), the search results, and the page excerpts. The model answers the way it would in the app, with the app's sampling, thinking budget and chat template settings.

The questions live in `scripts/wllama-bench/cases.json`. Each one carries its own search results, written for the test so the right answer is known, the facts a correct answer must contain, and the language it must be in. They cover what the system prompt asks of a model:

- **Answering in the question's language**, across eleven languages: English, Portuguese, Spanish, French, German, Chinese, Japanese, Korean, Arabic, Hindi and Russian. They are the languages most often listed as supported by the model families in the catalog and by multilingual benchmarks, with Russian added for its share of web text; see [Why these languages](#why-these-languages).
- **Answering in one language from results in another** (`pt-from-en`, `zh-from-en`).
- **Combining two results** (`de-synthesis`).
- **Picking the right result among similar ones** (`es-distractor`).
- **Saying so when the results do not answer** (`pt-not-covered`).
- **Citing a result with a link, and never inventing one.**

## How it scores

`scripts/wllama-bench/score.mjs` scores every answer out of 4 points:

| Points  | For                                                                                                                                                                                                                                                                                        |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| up to 2 | The required facts, split evenly. A wrong fact misleads more than a wrong language, so facts weigh double.                                                                                                                                                                                 |
| 1       | Answering in the question's language. Text copied from the results does not count, so a quoted snippet cannot pass for an answer written in that language.                                                                                                                                 |
| 1       | Citing at least one of the results with a Markdown link.                                                                                                                                                                                                                                   |
| −1 each | A violation: a link to a URL that is not among the results, an echoed instruction from the prompt, a repeated sentence, a third script mixed in (Cyrillic in a Hindi answer), a number that appears in no result, a fact from the distractor result, or an answer cut off after 5 minutes. |

The score never goes below 0. English questions count once and the others twice, because MiniSearch takes queries in any language. A model's score is the sum over the questions, averaged over its runs.

### What the score cannot see

The checks are mechanical. Text that is garbled but in the right language and carrying the right facts passes them, and so does a correct answer that only restates the result it was given. Before the scorer was adopted, 176 answers were graded by hand as fluent and correct or not, and the scorer agreed with the hand grade on 149 of them (85%) with a pass mark of 2 points. Nearly all of the disagreements were about fluency. Treat a gap of a few points between two models as noise: the app samples, so a second run differs.

## Why these languages

The catalog's model families and the common multilingual benchmarks agree on a core:

- Llama 3.2 officially supports English, German, French, Italian, Portuguese, Hindi, Spanish and Thai ([model card](https://huggingface.co/meta-llama/Llama-3.2-1B-Instruct)).
- OpenAI's MMMLU translates MMLU into Arabic, Bengali, German, Spanish, French, Hindi, Indonesian, Italian, Japanese, Korean, Portuguese, Swahili, Yoruba and Chinese ([dataset card](https://huggingface.co/datasets/openai/MMMLU/blob/main/README.md)).
- LFM2 lists English, Arabic, Chinese, French, German, Japanese, Korean and Spanish ([model card](https://huggingface.co/LiquidAI/LFM2-2.6B/blob/refs%2Fpr%2F7/README.md)).
- Russian is among the largest languages in Common Crawl after English, in the group that each makes up a few percent of its pages ([Common Crawl](https://en.wikipedia.org/wiki/Common_Crawl)).

## Running it

```bash
npm run bench:wllama -- --model littlelamb-290m --model qwen-3-0.6b --device webgpu --runs 2 --json results.json
node scripts/wllama-bench/score.mjs scripts/wllama-bench/cases.json results.json
```

The first command prints the score at the end; the second re-scores saved results, for example after a change to the scorer. To vet a model that is not in the catalog yet, pass `--model owner/repo/file-00001-of-0000N.gguf`.
