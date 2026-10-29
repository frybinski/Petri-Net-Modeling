import { validate, type Diagnostic, type PetriNet } from '@pnm/core';
import { validateDomainView, type DomainDiagnostic } from '@pnm/domain';
import { parseCommandArgs, requireOne } from '../args';
import { makeStyle, plural, table } from '../format';
import type { Io } from '../io';
import { loadNet, reportImportWarnings } from '../net-file';

export const VALIDATE_HELP = `Usage: pnm validate <net> [--json]

Checks a net (a .pn.json or PNML file, or - for standard input) and, if the net has one, its
domain view (rules V1 to V8).

  --json    print the result as JSON

Exit status: 0 no errors (warnings are allowed), 1 errors found or the file cannot be read.
`;

function nameOf(net: PetriNet, id: string | undefined): string {
  if (id === undefined) return '';
  const node = [...net.places, ...net.transitions].find((n) => n.id === id);
  return node && node.name !== '' && node.name !== id ? `${id} (${node.name})` : id;
}

export async function validateCommand(io: Io, args: readonly string[]): Promise<number> {
  const { values, positionals } = parseCommandArgs(args, { json: { type: 'boolean' } });
  const path = requireOne(positionals, 'net file');
  const loaded = await loadNet(io, path);
  const { net } = loaded;

  const core: Diagnostic[] = validate(net);
  const domain = net.domainView === undefined ? undefined : validateDomainView(net, net.domainView);
  const domainDiagnostics: DomainDiagnostic[] = domain?.diagnostics ?? [];
  const errors =
    core.filter((d) => d.severity === 'error').length +
    domainDiagnostics.filter((d) => d.severity === 'error').length;
  const warnings =
    core.filter((d) => d.severity === 'warning').length +
    domainDiagnostics.filter((d) => d.severity === 'warning').length;

  if (values.json === true) {
    io.out(
      `${JSON.stringify(
        {
          file: path,
          ok: errors === 0,
          errors,
          warnings,
          places: net.places.length,
          transitions: net.transitions.length,
          arcs: net.arcs.length,
          importWarnings: loaded.importWarnings,
          diagnostics: core.map((d) => ({
            severity: d.severity,
            code: d.code,
            message: d.message,
            ...(d.elementId !== undefined && { elementId: d.elementId }),
            ...(d.typeName !== undefined && { typeName: d.typeName }),
          })),
          domainView:
            domain === undefined
              ? { present: false }
              : {
                  present: true,
                  ok: domain.ok,
                  diagnostics: domainDiagnostics.map((d) => ({
                    rule: d.rule,
                    severity: d.severity,
                    path: d.path,
                    message: d.message,
                    ...(d.elementId !== undefined && { elementId: d.elementId }),
                  })),
                },
        },
        null,
        2,
      )}\n`,
    );
    return errors === 0 ? 0 : 1;
  }

  const style = makeStyle(io.color);
  reportImportWarnings(io, path, loaded);
  const sizes = `${plural(net.places.length, 'place')}, ${plural(net.transitions.length, 'transition')}, ${plural(net.arcs.length, 'arc')}`;
  const verdict =
    errors === 0 && warnings === 0
      ? style.green('valid')
      : `${plural(errors, 'error')}, ${plural(warnings, 'warning')}`;
  io.out(`${path}: ${verdict} (${sizes}${domain ? ', with domain view' : ''})\n`);

  const severity = (value: 'error' | 'warning'): string =>
    value === 'error' ? style.red('error') : style.yellow('warning');
  if (core.length > 0) {
    io.out(
      table(
        [{ header: 'SEVERITY' }, { header: 'CODE' }, { header: 'ELEMENT' }, { header: 'MESSAGE' }],
        core.map((d) => [severity(d.severity), d.code, nameOf(net, d.elementId), d.message]),
      ),
    );
  }
  if (domainDiagnostics.length > 0) {
    io.out(
      table(
        [{ header: 'SEVERITY' }, { header: 'RULE' }, { header: 'PATH' }, { header: 'MESSAGE' }],
        domainDiagnostics.map((d) => [severity(d.severity), d.rule, d.path, d.message]),
      ),
    );
  }
  return errors === 0 ? 0 : 1;
}
