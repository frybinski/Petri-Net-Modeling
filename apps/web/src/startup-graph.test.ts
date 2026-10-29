import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

// The start of the app must not pull in the analysis, the domain view, the export formats or the
// LLM client: those are chunks that load on demand (see `components/lazy-parts.tsx`). This walks
// the static imports from the entry point, the way the bundler does, and checks which packages
// the start reaches. A dynamic `import()` and a type-only import do not count.

const root = join(dirname(fileURLToPath(import.meta.url)));

function resolveModule(from: string, specifier: string): string | null {
  const base = resolve(dirname(from), specifier);
  for (const candidate of [`${base}.ts`, `${base}.tsx`, join(base, 'index.ts'), base]) {
    if (existsSync(candidate) && /\.(ts|tsx)$/.test(candidate)) return candidate;
  }
  return null;
}

/** The modules that a file imports as values (not types, not dynamically). */
function staticImports(file: string): string[] {
  const source = ts.createSourceFile(
    file,
    readFileSync(file, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
  );
  const found: string[] = [];
  for (const statement of source.statements) {
    if (ts.isImportDeclaration(statement)) {
      const clause = statement.importClause;
      if (clause?.isTypeOnly) continue;
      const named = clause?.namedBindings;
      const onlyTypes =
        clause !== undefined &&
        clause.name === undefined &&
        named !== undefined &&
        ts.isNamedImports(named) &&
        named.elements.length > 0 &&
        named.elements.every((element) => element.isTypeOnly);
      if (onlyTypes) continue;
      if (ts.isStringLiteral(statement.moduleSpecifier)) found.push(statement.moduleSpecifier.text);
    } else if (
      ts.isExportDeclaration(statement) &&
      !statement.isTypeOnly &&
      statement.moduleSpecifier !== undefined &&
      ts.isStringLiteral(statement.moduleSpecifier)
    ) {
      found.push(statement.moduleSpecifier.text);
    }
  }
  return found;
}

/** Every package and every source file that the entry reaches through static imports. */
function reachable(entry: string): { packages: Set<string>; files: Set<string> } {
  const packages = new Set<string>();
  const files = new Set<string>();
  const queue = [entry];
  while (queue.length > 0) {
    const file = queue.pop() as string;
    if (files.has(file)) continue;
    files.add(file);
    for (const specifier of staticImports(file)) {
      if (specifier.startsWith('.')) {
        const target = resolveModule(file, specifier);
        if (target) queue.push(target);
      } else {
        packages.add(specifier);
      }
    }
  }
  return { packages, files };
}

describe('what the start of the app loads', () => {
  const { packages, files } = reachable(join(root, 'main.tsx'));
  const names = [...files].map((f) => f.slice(root.length + 1));

  it('does not reach the packages of the parts that load on demand', () => {
    // `@pnm/analysis` is imported for one small function (`markingKey`), which the bundler keeps
    // on its own; `@pnm/layout/geometry` is plain arithmetic. The layout engine (ELK, 1.4 MB) is
    // `@pnm/layout` itself and loads when a layout is asked for.
    const heavy = [...packages].filter(
      (p) => /^@pnm\/(domain|io|llm)(\/|$)/.test(p) || p === '@pnm/layout',
    );
    expect(heavy).toEqual([]);
  });

  it('does not reach the code of the analysis, the domain view or the dialogs of the exports', () => {
    // A few small files stay: the registrations through which the commands reach the domain view
    // once it is loaded, the switch between the views, and two stores of plain state.
    const small = new Set([
      'lib/domain-view-api.ts',
      'lib/domain-edit-api.ts',
      'store/generation-store.ts',
      'components/domain/view-switch.tsx',
      'components/export/import-report-dialog.tsx',
    ]);
    const lazy = names.filter(
      (n) =>
        /^(components\/(analysis|domain|llm|export)\/|lib\/(analysis|domain)-|store\/(analysis|generation)-)/.test(
          n,
        ) && !small.has(n),
    );
    expect(lazy).toEqual([]);
  });

  it('does reach the editor itself', () => {
    expect(names).toContain('components/canvas/flow-canvas.tsx');
    expect(packages).toContain('@pnm/core');
  });
});
