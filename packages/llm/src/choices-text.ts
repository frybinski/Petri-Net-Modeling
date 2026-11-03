import type { PetriNet } from '@pnm/core';
import { counterPlaces, displayOfChoice, stagePlaces, type ViewChoices } from '@pnm/domain';

/**
 * The text of the guided way (N4): the choices of a form as a section of the request, and the
 * description of the domain that is made of them. The wording is fixed, so it must not name a
 * domain of the examples (the leak test covers it).
 */

const LAYOUT_TEXT: Record<ViewChoices['layout'], string> = {
  'left-to-right': 'Arrange the flow from left to right.',
  'top-to-bottom': 'Arrange the flow from top to bottom.',
  editor: 'Keep the arrangement of the net in the editor.',
};

const EQUIPMENT_TEXT: Record<ViewChoices['equipment'], string> = {
  plain: 'Plain: no scenery besides a few labels.',
  zones: 'Zones and labels: use "zone" and "label" in "decor" to mark the areas of the process.',
  floorplan:
    'A floor plan with rooms: use "room", "wall" and "furniture" in "decor", and put the stations into the rooms.',
};

/** The description of the domain that a form stands for: the setting, then the additions. */
export function composeDescription(choices: ViewChoices): string {
  const setting = choices.setting.trim();
  const additions = choices.additions.trim();
  return [setting, additions]
    .filter((part) => part !== '')
    .join('. ')
    .replace(/\.\.+/g, '.');
}

/** The section "Binding choices" of the first request, as lines. */
export function choicesSection(
  net: PetriNet,
  choices: ViewChoices,
  options: { positions?: boolean } = {},
): string[] {
  const names = new Map(net.places.map((p) => [p.id, p.name]));
  const entity = choices.entity;
  const lines = [
    '## Binding choices',
    'These come from the user. The tool sets the entity, the "appearance" and the "display" of every place named here to exactly this and replaces whatever you write instead. Write the same, and spend your effort on geometry, labels and decor.',
    `- Setting: ${JSON.stringify(choices.setting)}${choices.viewName.trim() !== '' ? `; name of the view: ${JSON.stringify(choices.viewName)}` : ''}.`,
    `- Entity: "meta.entity" with "singular" ${JSON.stringify(entity.singular)}, "plural" ${JSON.stringify(entity.plural)}, ${entity.emoji !== undefined ? `"emoji" ${JSON.stringify(entity.emoji)}` : `"sprite" ${JSON.stringify(entity.sprite)}`}.`,
  ];
  const stages = stagePlaces(net).filter((id) => id in choices.stages);
  if (stages.length > 0) {
    lines.push('- Looks of the cases, by place in the order of the flow:');
    for (const id of stages) {
      const look = choices.stages[id] ?? null;
      lines.push(
        `  - ${JSON.stringify(id)} (${names.get(id) ?? id}): ${look === null ? 'no "appearance" (the cases look like the entity)' : `"appearance" ${JSON.stringify(look)}`}`,
      );
    }
  }
  const counters = counterPlaces(net).filter((id) => id in choices.counters);
  if (counters.length > 0) {
    lines.push('- Counters, by place:');
    for (const id of counters) {
      const choice = choices.counters[id]!;
      const display = displayOfChoice(choice, undefined);
      lines.push(
        `  - ${JSON.stringify(id)} (${names.get(id) ?? id}): ${display === undefined ? 'no "display" (the number only)' : `"display" ${JSON.stringify(display)}`}`,
      );
    }
  }
  const layout =
    choices.layout === 'editor' && options.positions === false
      ? LAYOUT_TEXT['left-to-right']
      : LAYOUT_TEXT[choices.layout];
  lines.push(`- Arrangement: ${layout}`, `- Equipment: ${EQUIPMENT_TEXT[choices.equipment]}`);
  if (choices.additions.trim() !== '') {
    lines.push(`- Additions of the user: ${choices.additions.trim()}`);
  }
  return lines;
}
