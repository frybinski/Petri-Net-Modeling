import { paintScene, type Scene, type ScenePalette } from '@pnm/domain';

/** Room around the sheet in the offscreen layer for its shadow, in scene pixels. */
const PAD = 32;
/** The largest side and the largest area of the offscreen layer, in device pixels. */
const MAX_SIDE = 4096;
const MAX_AREA = 16_000_000;

/** Re-render when the wanted scale differs from the rendered one by more than this. */
const SCALE_TOLERANCE = 0.02;

/**
 * The static part of the domain view (sheet, scenery, belts, cards, labels) rendered once into an
 * offscreen canvas. A frame then costs one `drawImage` instead of several hundred draw commands.
 * It is rebuilt when the scene, the palette or the scale (device pixel ratio times zoom) change.
 */
export class StaticLayer {
  private canvas: HTMLCanvasElement | null = null;
  private scene: Scene | null = null;
  private paletteKey = '';
  private rendered = 0;
  /** How many times the layer was rendered, for the tests and the status of the canvas. */
  renders = 0;

  /** The scale at which the layer can be drawn without losing sharpness for a sheet. */
  static clampScale(scene: Scene, wanted: number): number {
    const w = scene.width + 2 * PAD;
    const h = scene.height + 2 * PAD;
    const bySide = MAX_SIDE / Math.max(w, h);
    const byArea = Math.sqrt(MAX_AREA / (w * h));
    return Math.max(0.1, Math.min(wanted, bySide, byArea));
  }

  /** True if the content (not the scale) is up to date. */
  isCurrent(scene: Scene, paletteKey: string): boolean {
    return this.canvas !== null && this.scene === scene && this.paletteKey === paletteKey;
  }

  /** True if the layer was rendered at a scale close to `wanted`. */
  hasScale(scene: Scene, wanted: number): boolean {
    const scale = StaticLayer.clampScale(scene, wanted);
    return Math.abs(scale / this.rendered - 1) <= SCALE_TOLERANCE;
  }

  /** Renders the scene at `wanted` device pixels per scene pixel. Returns false without a 2D context. */
  render(scene: Scene, palette: ScenePalette, paletteKey: string, wanted: number): boolean {
    const scale = StaticLayer.clampScale(scene, wanted);
    const canvas = this.canvas ?? document.createElement('canvas');
    canvas.width = Math.ceil((scene.width + 2 * PAD) * scale);
    canvas.height = Math.ceil((scene.height + 2 * PAD) * scale);
    const ctx = canvas.getContext('2d');
    if (!ctx) return false;
    ctx.setTransform(scale, 0, 0, scale, PAD * scale, PAD * scale);
    paintScene(ctx, scene, palette, { scale });
    this.canvas = canvas;
    this.scene = scene;
    this.paletteKey = paletteKey;
    this.rendered = scale;
    this.renders += 1;
    return true;
  }

  /** Draws the layer into a context whose transform maps scene pixels to device pixels. */
  draw(ctx: CanvasRenderingContext2D, scene: Scene): void {
    if (!this.canvas) return;
    ctx.drawImage(this.canvas, -PAD, -PAD, scene.width + 2 * PAD, scene.height + 2 * PAD);
  }

  dispose(): void {
    this.canvas = null;
    this.scene = null;
  }
}
