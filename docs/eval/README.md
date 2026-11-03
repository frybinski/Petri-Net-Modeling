# Evaluations

This folder holds the results of two evaluations: language models (acceptance A6, below) and the event log export
with pm4py (acceptance A8, at the end).

## Language models (acceptance A6)

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

## Options for experiments

These options are for comparing conditions, for example in the experiments of a thesis. Without them the script does what
it did in 1.4.0 (the app's setting: both default examples and the editor positions). `--examples` still names the nets
that are **evaluated**.

| Option                      | Effect                                                                                                                                                                                                     |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--shots <ids>` / `none`    | The nets whose views are shown to the model as worked examples (default `parcel-center,smart-office`). The net that is evaluated is always left out. `none` is zero-shot.                                  |
| `--no-positions`            | Sends no editor positions, neither of the net nor of the examples, and leaves out the sentence about them in the system text.                                                                              |
| `--description <id>=<text>` | The description of the domain for one net; repeat the option for more nets. Built-in sentences exist for `parcel-center`, `smart-office` and `bike-frames`; a net without one gets "A process called ...". |
| `--descriptions <file>`     | The same as a JSON file `{ "<id>": "<text>" }`. `--description` wins over the file.                                                                                                                        |
| `--repeat <n>`              | Generates every net `n` times, independently (1 to 100). The report lists every run and a summary.                                                                                                         |
| `--save-prompts`            | Writes the first request of every net (system and user text) next to the report.                                                                                                                           |

An unknown net id in `--examples`, `--shots` or `--description`, a shot without a domain view, a description given twice
and a bad file are refused before the first request (exit status 64).

An ablation of what the model takes from the prompt: the bicycle frame example, with and without positions, with and
without worked examples, three runs each. Every condition gets its own folder, because the file names carry the model and
the date, not the condition; the report names the condition in its section _Conditions_.

```sh
run() { # <folder> <options>
  d=docs/eval/ablation/$1; shift
  pnpm --filter @pnm/llm eval -- --base-url http://localhost:11434/v1 --model qwen2.5:14b \
    --examples bike-frames --repeat 3 --save-prompts --out-dir "$d" "$@"
}
run full
run no-positions --no-positions
run zero-shot --shots none
run bare --shots none --no-positions
```

With `--shots none --no-positions` what the view contains comes from the net, the description and the rules alone; the
difference to the run with positions and examples shows how much the model takes from the prompt.

## What it writes

- `llm-<model>-<date>.md`: the report. It has the sections _Conditions_ (prompt version, worked examples, positions,
  temperature, JSON mode, rounds, runs per net, the description of every net), _Results_ (a table with result PASS, FILLED or
  FALLBACK, rounds, errors per round, warnings, filled and dropped entries, time and tokens for every run), _Summary of the
  runs_ (with `--repeat` above 1: share of runs that passed, rounds per run as a distribution, mean time, tokens),
  _Similarity to the reference view_, _First request_ (prompt version and SHA-256 of the system and the user text) and the
  findings of every round.
- `llm-<model>-<date>.report.json`: the same as data (`conditions`, `prompts`, `runs`, `summary`).
- `llm-<model>-<date>-<example>.json`: the generated view, which can be pasted into the JSON editor of the domain view;
  with `--repeat` one file per run, `...-<example>-run<k>.json`.
- With `--save-prompts`: `llm-<model>-<date>-<example>-prompt-system.txt` and `...-prompt-user.txt`, exactly the text that
  was sent, so that `sha256sum` of a file gives the hash in the report.

A net passes (A6) when the view of the model has no errors after at most three rounds without anything being filled in
or dropped.

### Similarity to the reference view

If the net has a view in `examples/`, each result is compared with it (`compareViews` in `@pnm/llm`):

- **Kind agreement:** the share of places and transitions whose `kind` is the same.
- **Mean distance:** the mean distance of the element centers (middle of a box, the point, the point halfway along a path),
  divided by the diagonal of the canvas of the reference. 0 is the same place, 1 the opposite corner. A hidden element and
  a `slots` place have no center and count only in the kind agreement; an element the result lacks counts as a different
  kind.
- **Appearance and display:** among the places where either view has the field, the share with the same sprite and tint, or
  the same style and icon. Numbers such as `max` and `per` are not compared. No value if neither view has the field.

Decor, arcs and labels are not compared. The values show how close a result is to the reference, not whether it is better;
a different good view is possible. Together with `--no-positions` and `--shots none` they separate what the model
contributes from what it takes over from the prompt.

### Stating a run in a paper

Give the prompt version (`PROMPT_VERSION`, 2 since 1.4.1; version 1 is the prompt of 1.4.0 and before, whose rules 7 and 10
named examples of the repository), the model, the temperature, the JSON mode, the worked examples, whether positions were
sent, the number of runs, and the SHA-256 of the system and of the user text of the first request from the report. The hash
identifies the exact request, including the description and the net; with `--save-prompts` the texts can be archived with the
data.

## Event log and pm4py (acceptance A8)

`pnpm --filter @pnm/io check:pm4py` simulates the parcel center for two hours (seed 1), writes the log as CSV and XES to a
scratch folder, reads both with pm4py, discovers a Petri net with the inductive miner from the rows with the lifecycle
`complete` and compares its activities with the names of the transitions that carry cases. The result is written to
`pm4py-<date>.md`.

pm4py is not a dependency of the repository. Create a virtual environment and point the script at it:

```sh
python3 -m venv .venv && .venv/bin/pip install pm4py pandas
PNM_PYTHON=.venv/bin/python pnpm --filter @pnm/io check:pm4py
```

Without `PNM_PYTHON` the script uses `python3`. Options: `--out-dir`, `--scratch`, `--date`, `--hours`, `--seed` and
`--example`. Exit status 0 means every check passed, 1 a failed check, 3 that pm4py cannot be imported (the message says
how to set it up).
