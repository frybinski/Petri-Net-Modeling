# ADR 0018: Quantity graphics and the appearance of cases

Status: accepted · Date: 2026-10-30

## Context

After N1 the bicycle frame production shows its CO₂e, its steel and its waste as numbers in boxes, and every frame is
drawn as the same vehicle from the first order to the shipment. Both are weak pictures. A number says little about a store
that holds 120 of 200 kg or about a total of 1 240 kg of CO₂e, and a "frame" that is a vehicle while it is still an order,
a few tubes or a bare weld is not what the process is about. The domain view should show amounts as a size you can see
at a glance and cases as what they are at each stage, without giving up what the method requires of a picture: the
quantities in it are the quantities of the net (K3), and what a picture can show depends on the role of the place (K4).

## Decision

- **Two styles, both with the number.** A counter (`pool`, `source`, `sink`) gets an optional `display`:
  - a **fill level** (`style: 'fill'`) is a container that is full at `max` and turns yellow below `low`. It is the picture
    for a store with a limit, and a limit exists in the net as well (the tube store and the free space add up to 200 kg,
    which the analysis finds);
  - a **pictogram** (`style: 'pictogram'`) is an Isotype chart: one symbol stands for `per` tokens, the rest is a partly
    filled symbol, and a legend says "1 symbol = 50 kg". It is the picture for a total that only grows (CO₂e, waste,
    shipped goods), which has no limit to fill.

  The number stays in every style. `display.history` adds a curve of the count over the simulated time.

- **Isotype and a fill level instead of free scaling.** Another way to show 1 240 would be a symbol whose size grows with the
  amount, or a bar with an axis that adapts to the maximum. Both hide the amount: the eye compares areas badly, and an axis
  that moves makes two pictures incomparable. A symbol that stands for a fixed amount is counted, not estimated, and its
  scale is on the picture; a container with a fixed limit has the same value for "full" in every frame. So the scale is
  always stated (the legend, the `max` text, the hover card) and **never changed to fit**: if more symbols are needed than
  the box holds, the last cell says `+N` instead of making the symbols smaller, and a count above `max` fills the container,
  marks it with a red border and a `213 > 200`, and is reported in the status of the view (and the status bar). Nothing is
  cut off without being seen (K3).

- **Rule V10 for the display, rule V11 for the appearance.** What can go wrong is told as a rule, with the path of the
  field, so that the editor can show it at the field and the language model gets it in a repair round. V10 (error): `max` or
  `per` not positive, `low` above `max`, a symbol that does not fit the role of the place (pictures of amounts for quantity
  places and sinks, pictures of objects for places that hold cases, the dot for every counter), a display on something that
  is no counter. V10 (hint): `max` below the `capacity` of the place. V11 (error): an appearance on a place that holds no
  cases (resource, quantity, hidden, pool). Role and picture are checked together because of K4: a quantity has no objects,
  so it has no appearance, and a resource shows the dot at best. V10 does not compare `max` with the invariants of the
  analysis: `@pnm/domain` does not depend on `@pnm/analysis`, and a rule that needs a state space does not belong to a check
  that runs on every keystroke. The comparison stays a note in the documentation.

- **The look hangs on the place, not on the case.** A case is drawn with the `appearance` of the place it lies on (`sprite`
  and an optional `tint`). The alternatives were a look in the data of the token (for JSON nets), or a look per transition.
  Token data is the extension to higher nets (D6) and would make a P/T net a special case, which is the wrong way round;
  the stages of a process are places in every net class, so the place is where every net can say it. A firing holds a case
  without a place: it keeps the look of the place it was taken from and takes the one of the place it goes to when the firing
  completes (250 ms of fade at most, at once when tokens jump and in a replay with the same events). A case that goes into a
  counter that has no appearance of its own is absorbed as it is. Where a transition has several case inputs the cases of a
  firing are matched to the input places by their order; that is exact for the usual one case input, and the animation and
  the layout agree about it, so that nothing flickers.

- **Tints are tokens of the palette.** `tint` is one of `accent`, `ok`, `warn`, `danger`, `info`, `neutral`, mapped to the
  tokens of the palette of the theme; the sprite takes the token as its body and a darker shade as its edge. A free color
  would be right in one theme and wrong in the other, and a language model would invent ones.

- **Symbols and sprites are drawn by the painter.** `frame`, `bicycle` and `bars` are canvas paths like the other sprites,
  and so are the symbols of amounts (`co2`, `material`, `scrap`, `waste`, `energy`, `water`). Thin pictures (a frame has
  tubes, not areas) get a dark casing under a bright core, and are drawn a little larger, so that they stay readable on
  belts in both themes. Sprites and symbols go through the sprite cache, so that a view with hundreds of cases and
  pictograms keeps the frame budget (the test with every new picture is in the suite).

- **The scene tells the truth without a canvas.** Heights of fill levels, the number and share of symbols, the cut with `+N`,
  the legend, the points of the curve and the look of every case are plain data in the draw commands and in the animation
  state, so that tests check them and Playwright reads them from `data-` attributes of the canvas. The history lives in the
  animation state, one point per event that changed a count, eight hours at most and 500 points per counter, older ones
  merged by minimum and maximum so that a jump of +80 kg never disappears; it is cut when the simulation steps back and
  starts again at a reset.

- **Compatibility.** All new fields are optional and the format stays `1.0`; views of 1.3.0 draw as before (the scenes of the
  parcel center, the smart office and the old view of the bicycle frame example are compared with those of 1.3.0). An older
  version refuses a view with `display` or `appearance` because its schema is strict, with the message that names the field.
  The generic view and the prompt examples have neither field: the generic view is always valid and does not know the
  domain well enough to scale a counter, and the language model gets one short paragraph about the fields and the lists of
  symbols, sprites and tints.

## Consequences

- A counter can be read at a glance and counted, the scale is always on the picture, and an overflow is visible in the
  picture, in the panel and in the status bar. The price is a more complicated painter: the layout of a counter box (title,
  number, legend, cells, curve) is a function of its size and is tested for every style.
- The look of a case follows the place, so what a case looks like at a stage is in the view and can be changed by hand,
  generated by the language model and checked by V11. It is not data of the tokens, so an example in which cases of one place
  look different (by their data) has to wait for D6.
- Pictograms with many symbols are bounded by the box: a long run ends in `+N`. The scale can be changed (`per`) in the
  inspector, one undo step.
- The curve is not part of an exported image (the export has a marking, not a run), and the comparison of `max` with the
  invariants of the net is a note for the author, not a rule.
