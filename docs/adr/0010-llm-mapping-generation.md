# ADR 0010: A language model proposes the mapping, the rules decide

Status: accepted · Date: 2026-10-28

## Context

Writing a domain view by hand takes time, and the generic view (ADR 0008) says little about the domain. A language
model can place a hall, its belts and gates from a sentence and the net, but it makes mistakes: it invents ids, draws a
case place as a resource, puts a gate outside the canvas. The tool must be usable with models of very different quality,
local and in the cloud, and the principle of the domain view must hold: the view shows, the net decides. Nothing the
model says may change the behaviour, and a wrong answer must be reported instead of believed.

## Decision

- **One interface: OpenAI-compatible chat completions.** `POST <base URL>/chat/completions` with `fetch` is spoken by
  Ollama, LM Studio, vLLM and the cloud services. There is no SDK per vendor. The provider is data (base URL, model,
  optional key, temperature, JSON mode), configured in the browser.
- **Called from the browser.** The app has no server, so the browser calls the provider directly. This keeps the
  data path short for local models (nothing leaves the machine) and costs nothing to host. The price is CORS: a local
  Ollama needs `OLLAMA_ORIGINS`, and a cloud service must allow browser calls. The settings dialog says so, names the
  data that is sent, and the error text points to the likely cause.
- **JSON mode by negotiation.** _Automatic_ tries a strict `json_schema` response format, falls back to `json_object` if
  the server refuses the field, then to plain text; the answer is parsed leniently (code block, first object in a
  text). The mode that worked is remembered for the session and logged per round.
- **The check decides, in a bounded loop.** The answer is merged entry by entry and checked with the rules V1 to V8 of
  D1. Errors go back as a repair request with the findings and the entries concerned; the model returns a partial
  object that replaces exactly these entries. At most three requests are made. What is still invalid is dropped and the
  gaps are filled with the generic view, so the result always passes V1 to V5 and the loop cannot end without a usable
  view. A failure after the first round ends the loop with a note; only a failure in round 1 is an error.
- **Provenance per entry.** Entries from the model carry `llm` with the model name and time, filled ones `generic`. The
  panel counts them, the hover card shows the model.
- **The log is stored next to the view, not in it.** The mapping keeps its strict schema. Model, server (without
  credentials), description, prompt, rounds and the filled and dropped paths go in an optional net field,
  `domainViewGeneration`, which the core passes through as `unknown` like `domainView` and removes together with it.
  `@pnm/llm` defines its schema and reads it tolerantly.
- **The key is never stored with the net.** It lives in its own `localStorage` entry in the browser, apart from the other
  settings. It appears in no document, export, record or log, and tests check this.
- **Never during a run.** The model is asked once, before the simulation. The dialog is disabled while simulating, and
  starting a simulation cancels a running job. The generation does not touch the simulator.
- **Worked examples without self-reference.** The prompt shows the parcel center and the smart office as examples. If
  the net has the structure of one of them, that example is left out, so that an evaluation is not a copy.
- **Acceptance in two stages.** There is no model in the development container. A scripted provider tests the loop
  (A6 with repair in round 2 for both examples), the web app is tested with a provider routed in Playwright, and a script
  (`pnpm --filter @pnm/llm eval`) lets a person measure a real model and keeps the report in `docs/eval/`.

## Consequences

- A person who uses a cloud model sends the structure of the net to a third party. The dialog says so; local models
  avoid it.
- The key in `localStorage` is readable by anyone who can use the browser profile and by scripts of the same origin. It
  is not encrypted. This is the usual trade-off of a client-only tool; a server component would change it.
- Quality depends on the model. Small models often fail V4 or the geometry rules; the repair loop fixes a part, the rest
  becomes generic entries and the log says which. Whether a given model passes A6 is measured with the script, not
  promised.
- Browsers that block mixed content refuse an `http://localhost` provider when the app is served over `https`
  (for example on GitHub Pages) in some configurations; running the app locally is the reliable way for local models.
- The record is not part of the strict mapping, so older tools that read `domainView` are unaffected and ignore the
  record; the repair loop's prompts can change without a format change.
