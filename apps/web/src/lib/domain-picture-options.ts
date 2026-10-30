import {
  TINT_TONES,
  drawIcon,
  drawSprite,
  spriteSize,
  type DisplayIcon,
  type ScenePalette,
  type Sprite,
  type Tint,
} from '@pnm/domain';

/** One choice of a picture picker: how it is drawn in its button, and its name. */
export interface PictureOption {
  value: string;
  label: string;
  /** Draws the preview centered on (`size` / 2, `size` / 2) of a square of `size` px. */
  draw: (ctx: CanvasRenderingContext2D, size: number, palette: ScenePalette) => void;
}

/** The preview of a symbol of an amount or of an object. */
export function iconOption(icon: DisplayIcon, label: string): PictureOption {
  return {
    value: icon,
    label,
    draw: (ctx, size, palette) => {
      drawIcon(ctx, icon, size / 2, size / 2, size * 0.7, palette);
    },
  };
}

/** The preview of a sprite, tinted or not. */
export function spriteOption(sprite: Sprite, label: string, tint?: Tint): PictureOption {
  return {
    value: sprite,
    label,
    draw: (ctx, size, palette) => {
      drawSprite(ctx, sprite, size / 2, size / 2, spriteSize(sprite) * 1.15, palette, 0, tint);
    },
  };
}

/** The preview of a tint: a disc in the color of the token (an empty ring for no tint). */
export function tintOption(tint: Tint | null, label: string): PictureOption {
  return {
    value: tint ?? '',
    label,
    draw: (ctx, size, palette) => {
      ctx.beginPath();
      ctx.arc(size / 2, size / 2, size * 0.3, 0, Math.PI * 2);
      if (tint === null) {
        ctx.strokeStyle = palette.inkMuted;
        ctx.lineWidth = 1.5;
        ctx.setLineDash([3, 3]);
        ctx.stroke();
        ctx.setLineDash([]);
        return;
      }
      ctx.fillStyle = palette[TINT_TONES[tint]];
      ctx.fill();
      ctx.strokeStyle = palette.ink2;
      ctx.lineWidth = 1;
      ctx.stroke();
    },
  };
}
