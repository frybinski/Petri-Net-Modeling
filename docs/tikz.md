# TikZ export

`toTikz(net, options)` in `@pnm/io` draws a net for LaTeX: places as circles, transitions as rectangles, arcs as
arrows, tokens as dots or numbers, with labels, guards, inscriptions and weights. The app offers it in
_File > Export > TikZ…_ (options, preview, copy, download as `.tex`), the command line as
`pnm export --format tikz`.

## Output

By default the result is a `tikzpicture` (a fragment). It needs `\usepackage{tikz}` in the document. Positions are
shifted so that the drawing starts at the origin and the y axis points up; 50 editor pixels are 1 cm.

```tex
\begin{tikzpicture}
  \tikzset{ place/.style={...}, transition/.style={...}, arc/.style={->, >=stealth, thick}, token/.style={...} }
  % Places
  \node[place, label={below:{Buffer}}] (buffer) at (6,2.4) {};
  \node[token] at (0,2.4) {};
  % Transitions
  \node[transition, label={below:{deliver}}] (deliver) at (3,3.9) {};
  % Arcs
  \draw[arc] (deliver) -- (buffer);
\end{tikzpicture}
```

Arcs in both directions between two nodes are drawn with `to[bend left=20]`, arcs with bend points as a polyline.
Weights and inscriptions are `node[midway, above, fill=white, font=\scriptsize]` on the arc; a guard is a label above
the transition in square brackets; a place type and a capacity (`k=3`) are small labels at the circle.

## Options

| Option         | Values                  | Default  | Meaning                                                                               |
| -------------- | ----------------------- | -------- | ------------------------------------------------------------------------------------- |
| `standalone`   | boolean                 | false    | A complete document (`\documentclass[tikz,border=4pt]{standalone}`).                  |
| `scale`        | number > 0              | 0.02     | Centimetres per editor pixel.                                                         |
| `labels`       | `names`, `ids`, `none`  | `names`  | What labels places and transitions.                                                   |
| `inscriptions` | boolean                 | true     | Guards, inscriptions, weights, types, capacities.                                     |
| `tokens`       | `dots`, `count`, `none` | `dots`   | Up to 5 dots per place (as in the editor), more tokens and JSON nets show the number. |
| `styles`       | `inline`, `external`    | `inline` | `inline` defines the styles in the picture, `external` leaves them to the document.   |
| `grayscale`    | boolean                 | true     | Black, white and grays only (affects the inline styles).                              |
| `marking`      | marking                 | initial  | The marking to draw.                                                                  |

## In a thesis: `\inputtikz` and external styles

The styles are named `place`, `transition`, `arc` and `token`, the names of the style file of the dissertation
(`grundlagen_styles.tex`). With `styles: 'external'` no definition is written, so the picture takes its look from the
document and changes with it. The fragment can be included with a macro such as

```tex
\newcommand{\inputtikz}[1]{\input{#1}}   % or the macro of your document class
\inputtikz{abbildungen/erzeuger-verbraucher.tex}
```

Without the thesis styles use the inline mode (the default). Neither mode needs a TikZ library.

## Escaping

Names and labels are escaped for `& % $ # _ { } ~ ^ \`; line breaks become spaces; umlauts and other UTF-8 letters stay
(use `\usepackage[utf8]{inputenc}` or a UTF-8 engine). Guards and inscriptions are escaped the same way and set in
`\texttt{}`. (The plan named `\detokenize` for this; it breaks on `%` and unbalanced braces, so characters are escaped
instead, which is safe for any text.)

## Checking

No TeX is needed to use the export, and the tests check the structure (environments and braces balance, one node per
element, snapshots). To see the result: `pnm export net.pn.json --format tikz --standalone -o net.tex && latexmk -pdf net.tex`.
