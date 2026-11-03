# ADR 0019: Emoji as free symbols, wishes with notes, and binding choices

Status: accepted · Date: 2026-11-03

## Context

A person wrote in the description for the language model that the tokens should be shown as unicorns, and nothing changed.
Three things came together: the tool knew eight fixed sprites; the JSON Schema of the answer enforced them, so the model had
no way to write anything else; and the description was only context in the prompt, with no sentence that said to follow
wishes about the look. The model also could not report what it was unable to do, so the person saw no difference and no
reason. The method asks that a picture says what the net says and nothing else (fidelity); a wish that is silently ignored
is a deviation that nobody can see.

## Decision

- **An emoji is the free vocabulary of symbols.** `meta.entity`, `appearance` and `display` take `emoji` in place of `sprite`
  or `icon`. The built-in symbols stay the default and the recommendation: they look the same everywhere, are readable in both
  themes and can be tinted. An emoji is validated as exactly one grapheme cluster that is a pictograph, a flag or a keycap
  (rule V12), because "a word" or "two emoji" would look like a symbol in the file and draw as text on the canvas.
  Alternatives that were left out: uploaded images or SVG (a decision about storing, exporting and the size of a file, and
  the point of the method is not the artwork), free color values (they break the light and the dark theme; a color wish is
  approximated by a tint of the palette).
- **An emoji is a text command in the scene**, not a sprite: `op: 'text'` with `emoji: true`, drawn with `fillText`. The scene
  stays testable without a canvas, and every place that draws a symbol can draw an emoji without a new kind of command.
- **A wish is followed, and a gap is reported.** The system text says that the description may hold wishes, to follow them
  within the format, to use an emoji where no built-in symbol fits, and that the answer may carry up to five short `notes` on
  what could not be done. The tool takes the notes out before checking and storing (they are no part of a view, so they can
  never make one invalid), collects them over the repair rounds and shows them next to the result. A note is the model's
  statement and is not checked against the description (limitation G9).
- **Two ways, one format.** The dialog offers a guided form and a free description. Both produce the same view and pass the
  same rules, so for the thesis they are two ways of collecting what a user wants, structured and free, that can be compared
  in the experiments (`--choices` of the evaluation script).
- **The guided choices are binding, and the tool enforces what it can.** Symbols, looks and displays are fields that the tool
  can write, so after the answer it sets them to exactly the choice and notes every deviation of the model ("Choice
  applied"). Arrangement and equipment are geometry that only the model draws; they act through the prompt, and the dialog
  says so (limitation G10). The same choices can be applied without a model, to the current or the generic view, without
  changing geometry.

## Consequences

- The prompt version is 3, and runs of version 2 are not comparable without saying so. The leak test also covers the new
  fixed texts, including the request for concepts.
- A view with `emoji` is not readable by a version before 1.5.0 (the schema is strict); the format version stays `1.0`.
- An emoji looks different on every system (limitation G7). That is the price of a free vocabulary without storing pictures.
