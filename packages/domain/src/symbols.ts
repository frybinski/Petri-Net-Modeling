import type { CommandBase, DrawCommand } from './scene';
import type { Appearance, DisplayIcon, Point, Sprite } from './schema';

/**
 * The commands that draw a symbol: a built-in sprite or icon, or an emoji (N4). They live apart
 * from the scene builder so that the counters can use them without a cycle of imports.
 */

/**
 * The size of a case on the canvas, 14 to 22 px depending on how much room the picture needs. The
 * thin pictures of a frame and a bicycle are drawn larger, so that their tubes stay readable.
 */
export function spriteSize(sprite: Sprite): number {
  switch (sprite) {
    case 'person':
    case 'vehicle':
      return 18;
    case 'dot':
      return 14;
    case 'parcel':
    case 'document':
      return 16;
    case 'bars':
      return 18;
    case 'frame':
      return 20;
    case 'bicycle':
      return 24;
  }
}

/** The size of an emoji case on the canvas: about as large as the sprites. */
export const EMOJI_CASE_SIZE = 18;

/** The size of a case with this look, built-in picture or emoji. */
export function appearanceSize(look: Appearance): number {
  return look.emoji !== undefined ? EMOJI_CASE_SIZE : spriteSize(look.sprite);
}

/**
 * The command that draws one emoji centered on (x, y), as large as a symbol of `size` (the emoji
 * fonts draw a glyph about a fifth wider than the font size).
 */
export function emojiCommand(
  base: CommandBase,
  emoji: string,
  x: number,
  y: number,
  size: number,
  extras: { alpha?: number; fraction?: number } = {},
): DrawCommand {
  return {
    ...base,
    op: 'text',
    x,
    y,
    text: emoji,
    size: Math.round(size * 0.85 * 10) / 10,
    weight: 400,
    tone: 'ink',
    align: 'center',
    baseline: 'middle',
    emoji: true,
    ...(extras.alpha !== undefined && { alpha: extras.alpha }),
    ...(extras.fraction !== undefined && extras.fraction < 1 && { fraction: extras.fraction }),
  };
}

/**
 * The command that draws a case with this look: a sprite, or an emoji. `direction` turns the
 * sprites that have a front.
 */
export function lookCommand(
  base: CommandBase,
  look: Appearance,
  point: Point,
  direction?: Point,
  alpha?: number,
): DrawCommand {
  if (look.emoji !== undefined) {
    return emojiCommand(base, look.emoji, point[0], point[1], EMOJI_CASE_SIZE, {
      ...(alpha !== undefined && { alpha }),
    });
  }
  const oriented = look.sprite === 'person' || look.sprite === 'vehicle';
  return {
    ...base,
    op: 'sprite',
    sprite: look.sprite,
    x: point[0],
    y: point[1],
    size: spriteSize(look.sprite),
    ...(oriented && direction !== undefined
      ? { angle: Math.atan2(direction[1], direction[0]) }
      : {}),
    ...(look.tint !== undefined && { tint: look.tint }),
    ...(alpha !== undefined && { alpha }),
  };
}

/** The command that draws a symbol of a counter: a built-in icon, or an emoji. */
export function symbolCommand(
  base: CommandBase,
  symbol: { icon?: DisplayIcon | undefined; emoji?: string | undefined },
  x: number,
  y: number,
  size: number,
  extras: { alpha?: number; fraction?: number } = {},
): DrawCommand {
  if (symbol.emoji !== undefined) return emojiCommand(base, symbol.emoji, x, y, size, extras);
  return {
    ...base,
    op: 'icon',
    icon: symbol.icon ?? 'dot',
    x,
    y,
    size,
    ...(extras.fraction !== undefined && { fraction: extras.fraction }),
    ...(extras.alpha !== undefined && { alpha: extras.alpha }),
  };
}
