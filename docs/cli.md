# Command line

`pnm` runs the core, the simulation, the exports and the domain view without a browser. It is one file,
`apps/cli/dist/pnm.js`, built with esbuild from the workspace packages; it needs Node 22 and nothing else.

```sh
pnpm install
pnpm --filter @pnm/cli build           # also part of pnpm build
node apps/cli/dist/pnm.js --help
# or, after linking: pnpm --filter @pnm/cli exec pnm --help
```

A `<net>` is a `.pn.json` or a PNML file (detected by content); `-` reads standard input. Exit status: **0** success,
**1** the command failed (errors in the net, unreadable file, failed run), **2** wrong usage (unknown command or option,
missing or bad argument). Messages go to standard error, results to standard output or to the file given. Output has no
colors unless standard output is a terminal (and `NO_COLOR` is unset).

## Commands

### `pnm validate <net> [--json]`

Checks the net (all diagnostic codes of the file format) and, if the net has a domain view, the rules V1 to V8.
Errors give exit status 1, warnings do not.

```
$ pnm validate examples/parcel-center.pn.json
examples/parcel-center.pn.json: valid (12 places, 9 transitions, 27 arcs, with domain view)
```

`--json` prints `{ ok, errors, warnings, diagnostics, domainView: { present, ok, diagnostics } }`.

### `pnm simulate <net> [options]`

Runs the timed simulation (the in-thread engine of `@pnm/sim`; the same events as the app for the same seed) and prints
the key figures.

| Option               | Meaning                                                                     |
| -------------------- | --------------------------------------------------------------------------- |
| `--seconds <n>`      | Model time, default 3600.                                                   |
| `--seed <n>`         | Seed (default: the net's, else 1).                                          |
| `--warmup <n>`       | Seconds left out of the key figures.                                        |
| `--rate <t>=<n>`     | Arrivals per hour of a source transition, by id or name; `off`. Repeatable. |
| `--start-time <iso>` | Time that simulation time 0 maps to in the exports.                         |
| `--csv <file>`       | Event log as CSV (`case_id, activity, timestamp, lifecycle`).               |
| `--xes <file>`       | Event log as XES.                                                           |
| `--metrics <file>`   | Key figures and run data as JSON.                                           |
| `--events <file>`    | The event stream, one JSON object per line.                                 |
| `--max-events <n>`   | Stop with an error beyond this many events (default 10 million).            |
| `--quiet`, `-q`      | No summary.                                                                 |

A file name of `-` writes to standard output; the summary then goes to standard error. Nets with errors are refused.

```
$ pnm simulate examples/parcel-center.pn.json --seconds 7200 --csv out.csv
Paketzentrum: simulated 2 h 00 min (7200 s), seed 1
  events             7047
  cases completed    529  (317.4 per hour)
  cases in system    22
  cycle time         mean 2 min 46 s, max 8 min 09 s

PLACE           ROLE      NOW    MEAN  MAX   MEAN WAIT
...
Wrote out.csv (6394 rows)
```

### `pnm export <net> --format svg|png|pnml|tikz|json [-o file]`

Writes a net in another format; without `-o` to standard output; the format can come from the extension of `-o`
(`.svg .pnml .tex .json .png`). Options per format: SVG `--dark --no-inscriptions --padding`; TikZ `--standalone --scale
--labels --tokens --styles --no-inscriptions --no-grayscale` (see [tikz.md](tikz.md)); PNML `--no-toolspecific`.
`--format json` converts PNML to `.pn.json`. An option for another format is a usage error.

**PNG is not available on the command line**: rasterising needs a browser (the app draws the SVG on a canvas with the
fonts embedded) and Node has no such function without a new dependency. `--format png` exits with status 1 and a message
that points to the app (_File > Export > Image_) or to a converter for the SVG (`rsvg-convert`, Inkscape).

### `pnm import <file.pnml> [-o net.pn.json] [--layout keep|auto]`

Reads PNML (see [the format](format.md#pnml)) and writes `.pn.json`, by default to standard output. Remarks of the
import are printed as `warning:` lines on standard error. `--layout keep` (default) uses the positions of the file and
lays the net out if they are missing; `auto` always lays out.

### `pnm layout <net> [-o file] [--direction RIGHT|DOWN] [--spacing n]`

New automatic layout (ELK), positions snapped to the grid of the editor, bend points removed. A name ending in `.pnml`
writes PNML.

### `pnm domain check|generic|generate <net>`

- `check [--view file] [--json]`: rules V1 to V8 for the view of the net or for a view file. Exit 1 on errors or if there
  is no view.
- `generic [-o file] [--view-only]`: adds the generic view (a view written by a model is replaced).
- `generate --description "…" --base-url <url> --model <name> [--api-key <key>] [-o file]`: lets a language model make
  the view with the repair loop of the app (`@pnm/llm`). The server is OpenAI-compatible (Ollama, LM Studio, a cloud
  service). Environment: `PNM_LLM_BASE_URL`, `PNM_LLM_MODEL`, `PNM_LLM_API_KEY` (the key is never printed or written).
  Further: `--json-mode`, `--temperature`, `--rounds`, `--timeout`, `--width --height`, `--quiet`. The result is the net
  with `domainView` and the record `domainViewGeneration`; if the model's answer is unusable the generic view is used,
  and the message says so.

### `pnm examples list | copy <name> [dir] [--force]`

The example nets are built into the program. `copy` writes `<dir>/<name>.pn.json` and does not replace a file without
`--force`.

## Tests

`apps/cli/test` starts the bundle in a child process for every command (the test setup builds it first), including a
fake OpenAI server for `domain generate`, and compares the CSV and XES with those of the engine for the same seed.
