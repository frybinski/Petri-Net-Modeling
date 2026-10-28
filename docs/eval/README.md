# Evaluation of language models (acceptance A6)

This folder holds the results of runs of the evaluation script with a real model. It is empty until someone runs it:
the development container has no model, and the output of a simulated server is not kept here.

## Running it

Start an OpenAI-compatible server (for example Ollama with `ollama serve`, or LM Studio) and run, from the repository
root:

```sh
pnpm --filter @pnm/llm eval -- --base-url http://localhost:11434/v1 --model qwen2.5:14b
```

For a cloud service give the key with `--api-key <key>` or the environment variable `PNM_LLM_API_KEY`; the key is never
written to a file. Further options: `--json-mode auto|schema|object|none`, `--temperature`, `--rounds`, `--timeout`
(seconds per request), `--examples parcel-center,smart-office`, `--out-dir`, `--date` and `--strict` (exit status 2 if a
net needed filling). `pnpm --filter @pnm/llm eval -- --help` lists them all.

The script generates the domain view of the parcel center and of the smart office, prints the findings of every round
and a final table, and exits with status 1 if a request failed. The net that is evaluated never appears among its own
worked examples in the prompt.

## What it writes

- `llm-<model>-<date>.md`: a table with result (PASS, FILLED or FALLBACK), rounds, errors per round, warnings, filled and
  dropped entries, time and tokens, and the findings of every round.
- `llm-<model>-<date>-<example>.json`: the generated view, which can be pasted into the JSON editor of the domain view.

A net passes (A6) when the view of the model has no errors after at most three rounds without anything being filled in
or dropped.
