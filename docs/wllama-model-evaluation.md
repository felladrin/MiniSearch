# Wllama Model Evaluation

How the in-browser models in `client/modules/wllama.ts` are measured, and how they scored. The catalog keeps a model unless it answers worse than LittleLamb 290M, the default for browsers without WebGPU; see [What the catalog keeps](#what-the-catalog-keeps).

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

## Results

Measured on 2026-11-07 on an Apple M1 Max, in headless Chromium 151 on WebGPU, with wllama 3.8.1, the catalog's settings (a 1024-token thinking budget and `reasoning_effort: "low"`), and the app's sampling. Several models ran at once on the same GPU, so the run times are not comparable and are left out.

### The whole catalog, eleven core questions

Every model answered the first eleven questions (`en` to `ru`) once. LittleLamb and the models near its score ran three or four times, because the app samples and a single run can land 10 points either way: the spread between runs of one model averaged 5.5 points. Scores are out of 84.

| Rank | Model                                                                         |    Size | Runs |   Score |  en | pt-from-en |  es |  fr |  de |  zh |  ja |  ko |  ar |  hi |  ru |
| ---: | ----------------------------------------------------------------------------- | ------: | ---: | ------: | --: | ---------: | --: | --: | --: | --: | --: | --: | --: | --: | --: |
|    1 | Gemma 3 4B                                                                    | 2380 MB |    1 | 84.0/84 | 4.0 |        4.0 | 4.0 | 4.0 | 4.0 | 4.0 | 4.0 | 4.0 | 4.0 | 4.0 | 4.0 |
|    2 | Granite 3.3 2B                                                                | 1460 MB |    1 | 84.0/84 | 4.0 |        4.0 | 4.0 | 4.0 | 4.0 | 4.0 | 4.0 | 4.0 | 4.0 | 4.0 | 4.0 |
|    3 | Llama 3.2 3B                                                                  | 1930 MB |    1 | 84.0/84 | 4.0 |        4.0 | 4.0 | 4.0 | 4.0 | 4.0 | 4.0 | 4.0 | 4.0 | 4.0 | 4.0 |
|    4 | Polaris 4B                                                                    | 2380 MB |    1 | 82.0/84 | 4.0 |        4.0 | 4.0 | 4.0 | 4.0 | 3.0 | 4.0 | 4.0 | 4.0 | 4.0 | 4.0 |
|    5 | Spark X2.6 1.7B                                                               | 1769 MB |    1 | 82.0/84 | 4.0 |        3.0 | 4.0 | 4.0 | 4.0 | 4.0 | 4.0 | 4.0 | 4.0 | 4.0 | 4.0 |
|    6 | Gemma 2 2B                                                                    | 1640 MB |    1 | 79.3/84 | 3.3 |        4.0 | 4.0 | 4.0 | 4.0 | 3.0 | 4.0 | 4.0 | 4.0 | 3.0 | 4.0 |
|    7 | Qwen 3.5 4B                                                                   | 2436 MB |    1 | 77.0/84 | 3.0 |        3.0 | 3.0 | 4.0 | 3.0 | 4.0 | 4.0 | 4.0 | 4.0 | 4.0 | 4.0 |
|    8 | Falcon 3 3B                                                                   | 1930 MB |    1 | 74.0/84 | 4.0 |        3.0 | 3.0 | 4.0 | 3.0 | 4.0 | 4.0 | 4.0 | 4.0 | 3.0 | 3.0 |
|    9 | Phi 3.5 Mini 3.8B                                                             | 2190 MB |    1 | 74.0/84 | 4.0 |        4.0 | 1.0 | 4.0 | 4.0 | 4.0 | 4.0 | 4.0 | 3.0 | 4.0 | 3.0 |
|   10 | LFM2.5 1.2B Instruct                                                          |  700 MB |    1 | 70.0/84 | 4.0 |        3.0 | 4.0 | 4.0 | 3.0 | 3.0 | 3.0 | 3.0 | 4.0 | 3.0 | 3.0 |
|   11 | Qwen 3.5 0.8B                                                                 |  533 MB |    1 | 70.0/84 | 4.0 |        1.0 | 2.0 | 4.0 | 4.0 | 4.0 | 3.0 | 4.0 | 3.0 | 4.0 | 4.0 |
|   12 | EXAONE 3.5 2.4B                                                               | 1580 MB |    1 | 67.0/84 | 1.0 |        1.0 | 4.0 | 4.0 | 0.0 | 4.0 | 4.0 | 4.0 | 4.0 | 4.0 | 4.0 |
|   13 | Qwen 3 1.7B                                                                   | 1140 MB |    1 | 66.0/84 | 4.0 |        3.0 | 4.0 | 3.0 | 3.0 | 3.0 | 3.0 | 3.0 | 3.0 | 3.0 | 3.0 |
|   14 | SmolLM 3 3B                                                                   | 1820 MB |    1 | 65.0/84 | 3.0 |        4.0 | 3.0 | 4.0 | 3.0 | 3.0 | 3.0 | 3.0 | 2.0 | 3.0 | 3.0 |
|   15 | Qwen 3 0.6B                                                                   |  406 MB |    1 | 63.0/84 | 3.0 |        2.0 | 4.0 | 3.0 | 3.0 | 3.0 | 4.0 | 3.0 | 2.0 | 3.0 | 3.0 |
|   16 | Granite 3.1 1B [400M]                                                         |  775 MB |    1 | 61.0/84 | 3.0 |        1.0 | 3.0 | 3.0 | 3.0 | 3.0 | 3.0 | 4.0 | 4.0 | 2.0 | 3.0 |
|   17 | AceInstruct 1.5B                                                              | 1070 MB |    1 | 60.3/84 | 2.3 |        1.0 | 3.0 | 3.0 | 3.0 | 3.0 | 4.0 | 4.0 | 3.0 | 3.0 | 2.0 |
|   18 | SmolLM 2 1.7B                                                                 |  999 MB |    1 | 60.3/84 | 2.3 |        1.0 | 3.0 | 3.0 | 3.0 | 4.0 | 3.0 | 3.0 | 3.0 | 2.0 | 4.0 |
|   19 | Granite 3.1 3B [800M]                                                         | 1900 MB |    1 | 59.3/84 | 1.3 |        1.0 | 3.0 | 2.0 | 3.0 | 4.0 | 4.0 | 4.0 | 3.0 | 3.0 | 2.0 |
|   20 | Granite 4.2 3B                                                                | 2143 MB |    1 | 59.3/84 | 3.3 |        2.0 | 3.0 | 2.0 | 3.0 | 2.0 | 2.0 | 4.0 | 3.0 | 3.0 | 4.0 |
|   21 | Llama 3.2 1B                                                                  |  776 MB |    3 | 59.2/84 | 2.6 |        3.3 | 3.0 | 3.3 | 3.0 | 2.3 | 2.0 | 2.0 | 3.0 | 3.7 | 2.7 |
|   22 | InternLM 2.5 1.8B                                                             | 1120 MB |    3 | 58.7/84 | 2.0 |        2.7 | 3.0 | 3.3 | 3.0 | 3.0 | 2.3 | 3.3 | 3.7 | 1.3 | 2.7 |
|   23 | Spark X2.6 4B                                                                 | 3543 MB |    1 | 57.0/84 | 3.0 |        4.0 | 0.0 | 0.0 | 0.0 | 4.0 | 4.0 | 4.0 | 4.0 | 3.0 | 4.0 |
|   24 | ~~Granite 4.0 1B~~ (removed: scored on the CPU; on WebGPU it writes only `@`) |  981 MB |    1 | 56.0/84 | 4.0 |        3.0 | 3.0 | 4.0 | 2.0 | 3.0 | 1.0 | 2.0 | 4.0 | 0.0 | 4.0 |
|   25 | Megrez 3B                                                                     | 1740 MB |    3 | 55.7/84 | 3.0 |        2.0 | 2.3 | 3.0 | 3.3 | 3.0 | 3.0 | 3.0 | 2.0 | 1.0 | 3.7 |
|   26 | Gemma 4 E2B                                                                   | 2446 MB |    1 | 55.0/84 | 1.0 |        0.0 | 0.0 | 1.0 | 3.0 | 4.0 | 4.0 | 4.0 | 4.0 | 3.0 | 4.0 |
|   27 | Falcon 3 1B                                                                   | 1020 MB |    3 | 54.3/84 | 2.3 |        1.7 | 3.7 | 2.7 | 3.0 | 1.3 | 2.0 | 3.0 | 3.3 | 3.0 | 2.3 |
|   28 | Phi 4 Mini Reasoning 3.8B                                                     | 2460 MB |    3 | 50.7/84 | 2.7 |        0.7 | 2.3 | 2.7 | 1.3 | 3.3 | 3.0 | 3.7 | 2.7 | 2.0 | 2.3 |
|   29 | Gemma 3 1B                                                                    |  781 MB |    3 | 49.7/84 | 3.0 |        3.0 | 3.0 | 2.3 | 2.0 | 2.3 | 3.0 | 3.3 | 1.3 | 0.3 | 2.7 |
|   30 | LFM2.5 230M                                                                   |  160 MB |    3 | 49.0/84 | 3.0 |        3.0 | 3.0 | 3.0 | 3.0 | 0.0 | 3.0 | 2.0 | 2.7 | 2.3 | 1.0 |
|   31 | DeepSeek R1 Distill Qwen 1.5B                                                 | 1070 MB |    3 | 45.4/84 | 2.1 |        2.0 | 3.3 | 2.3 | 2.0 | 3.7 | 2.7 | 3.0 | 1.0 | 1.0 | 0.7 |
|   32 | SmolLM 2 360M                                                                 |  260 MB |    3 | 44.8/84 | 2.1 |        2.0 | 2.7 | 2.7 | 1.0 | 2.3 | 2.3 | 2.0 | 1.7 | 1.7 | 3.0 |
|   33 | MiniCPM4 0.5B                                                                 |  267 MB |    3 | 41.6/84 | 2.2 |        0.3 | 2.7 | 1.7 | 0.7 | 2.0 | 3.3 | 2.3 | 1.7 | 2.0 | 3.0 |
|   34 | OLMo 2 1B                                                                     |  967 MB |    3 | 41.6/84 | 0.9 |        0.0 | 2.0 | 2.7 | 1.0 | 2.3 | 1.7 | 2.3 | 3.0 | 3.3 | 2.0 |
|   35 | Gemma 3 270M                                                                  |  250 MB |    3 | 40.1/84 | 2.1 |        2.0 | 2.0 | 2.0 | 0.0 | 3.0 | 0.0 | 3.0 | 3.0 | 1.0 | 3.0 |
|   36 | LittleLamb 290M                                                               |  231 MB |    4 | 38.0/84 | 2.5 |        1.5 | 2.5 | 2.3 | 3.0 | 2.5 | 2.0 | 1.3 | 1.0 | 0.3 | 1.5 |
|   37 | ~~Pints 1.5B~~ (removed)                                                      |  905 MB |    1 | 25.3/84 | 1.3 |        1.0 | 3.0 | 2.0 | 0.0 | 0.0 | 3.0 | 1.0 | 1.0 | 0.0 | 1.0 |
|   38 | ~~Granite 4.0 350M~~ (removed)                                                |  229 MB |    1 | 25.0/84 | 3.0 |        2.0 | 2.0 | 2.0 | 0.0 | 0.0 | 0.0 | 2.0 | 1.0 | 1.0 | 1.0 |
|   39 | ~~SmolLM 2 135M~~ (removed)                                                   |  102 MB |    1 | 24.7/84 | 0.7 |        1.0 | 1.0 | 2.0 | 1.0 | 3.0 | 0.0 | 1.0 | 1.0 | 1.0 | 1.0 |
|   40 | ~~StableLM 2 Zephyr 1.6B~~ (removed)                                          |  989 MB |    1 | 16.3/84 | 0.3 |        0.0 | 1.0 | 4.0 | 1.0 | 0.0 | 0.0 | 1.0 | 0.0 | 1.0 | 0.0 |

### What the catalog keeps

LittleLamb 290M is the catalog's floor: it is the default for browsers without WebGPU because it runs well on a CPU, and its answers are the least the catalog accepts. A model whose mean score falls below LittleLamb's (38.0, measured before LittleLamb got a thinking budget) leaves the catalog. A model that ties with it stays, because the score cannot see how a model writes, and some people prefer one model's style. On 2026-11-08 that removed StableLM 2 Zephyr 1.6B, SmolLM 2 135M, Granite 4.0 350M and Pints 1.5B, all far below the floor (16 to 25). Granite 4.0 1B scored above it on the CPU but was removed anyway, because on WebGPU it writes only `@` characters until it is stopped.

LittleLamb itself is the most erratic model measured (its four runs scored 49.0, 44.3, 33.7 and 25.0): it often answers in English, sometimes not at all, and its Arabic and Hindi answers are rarely usable. With the 1024-token thinking budget it scored 41.4 over three runs and left no answer empty.

### GPU default candidates, all fifteen questions

The eleven questions above are direct, and several models answered all of them, so they cannot rank the best ones. The twelve strongest candidates for the GPU default also answered the four harder questions (`de-synthesis`, `es-distractor`, `pt-not-covered`, `zh-from-en`), twice each. Scores are out of 116.

| Rank | Model                   |    Size | Runs |     Score |  en | pt-from-en |  es |  fr |  de |  zh |  ja |  ko |  ar |  hi |  ru | de-synthesis | es-distractor | pt-not-covered | zh-from-en |
| ---: | ----------------------- | ------: | ---: | --------: | --: | ---------: | --: | --: | --: | --: | --: | --: | --: | --: | --: | -----------: | ------------: | -------------: | ---------: |
|    1 | Gemma 3 4B              | 2380 MB |    2 | 116.0/116 | 4.0 |        4.0 | 4.0 | 4.0 | 4.0 | 4.0 | 4.0 | 4.0 | 4.0 | 4.0 | 4.0 |          4.0 |           4.0 |            4.0 |        4.0 |
|    2 | Spark X2.6 1.7B         | 1769 MB |    2 | 113.0/116 | 4.0 |        3.0 | 4.0 | 4.0 | 4.0 | 4.0 | 4.0 | 4.0 | 4.0 | 3.5 | 4.0 |          4.0 |           4.0 |            4.0 |        4.0 |
|    3 | Llama 3.2 3B            | 1930 MB |    2 | 110.5/116 | 3.5 |        3.5 | 4.0 | 4.0 | 4.0 | 4.0 | 4.0 | 4.0 | 4.0 | 4.0 | 3.0 |          3.0 |           4.0 |            4.0 |        4.0 |
|    4 | Polaris 4B              | 2380 MB |    2 | 106.0/116 | 4.0 |        4.0 | 4.0 | 4.0 | 4.0 | 3.0 | 4.0 | 4.0 | 4.0 | 4.0 | 4.0 |          3.5 |           4.0 |            1.0 |        3.5 |
|    5 | Granite 3.3 2B          | 1460 MB |    2 | 105.0/116 | 4.0 |        4.0 | 4.0 | 4.0 | 4.0 | 4.0 | 4.0 | 4.0 | 4.0 | 4.0 | 4.0 |          2.0 |           4.0 |            0.5 |        4.0 |
|    6 | Gemma 2 2B              | 1640 MB |    2 | 102.7/116 | 3.7 |        4.0 | 4.0 | 4.0 | 4.0 | 3.0 | 4.0 | 4.0 | 3.5 | 4.0 | 4.0 |          3.0 |           4.0 |            0.5 |        3.5 |
|    7 | Granite 4.2 3B          | 2143 MB |    2 |  95.0/116 | 4.0 |        1.5 | 3.0 | 3.5 | 3.0 | 3.0 | 4.0 | 4.0 | 4.0 | 4.0 | 3.5 |          4.0 |           3.0 |            2.0 |        3.0 |
|    8 | Falcon 3 3B             | 1930 MB |    2 |  93.5/116 | 3.5 |        2.5 | 3.5 | 4.0 | 3.0 | 4.0 | 4.0 | 4.0 | 2.5 | 2.5 | 4.0 |          2.5 |           4.0 |            0.5 |        4.0 |
|    9 | Phi 3.5 Mini 3.8B       | 2190 MB |    2 |  93.5/116 | 2.5 |        3.5 | 1.5 | 3.0 | 2.5 | 4.0 | 4.0 | 4.0 | 4.0 | 3.0 | 3.5 |          3.0 |           3.5 |            2.5 |        3.5 |
|   10 | Qwen 3.5 4B (see below) | 2436 MB |    2 |  90.0/116 | 2.0 |        2.0 | 1.5 | 2.0 | 1.5 | 4.0 | 4.0 | 4.0 | 4.0 | 3.0 | 3.0 |          3.5 |           4.0 |            3.5 |        4.0 |
|   11 | Qwen 3.5 0.8B           |  533 MB |    2 |  76.7/116 | 2.7 |        2.0 | 3.5 | 3.0 | 1.0 | 4.0 | 4.0 | 0.5 | 3.5 | 2.0 | 2.5 |          3.5 |           3.5 |            2.0 |        2.0 |
|   12 | LFM2.5 1.2B Instruct    |  700 MB |    2 |  74.0/116 | 4.0 |        3.0 | 3.5 | 2.5 | 2.5 | 2.5 | 3.0 | 2.5 | 3.0 | 2.0 | 2.0 |          1.0 |           2.5 |            2.0 |        3.0 |

Gemma 3 4B, the GPU default, scored every point in both runs. The harder questions separate the rest: `pt-not-covered` is the one most models fail, inventing Curitiba's population instead of saying the results do not give it, and `de-synthesis` catches models that compute the difference between the two mountains wrong. Qwen 3.5 4B's first run shared the GPU with other runs and hit the 5-minute limit on six questions; its second run, alone, scored 108.

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
