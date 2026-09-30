import { afterEach, describe, expect, it, vi } from 'vitest';

import { IMAGE_PRESETS, fileToCompressedDataUri } from './image.util';

/** Un data URI pesa (casi) lo que su largo en bytes. Para los tests alcanza
 *  con el largo de la cadena: no hace falta decodificar base64. */
const dataUri = (bytes: number) => `data:image/jpeg;base64,${'A'.repeat(bytes)}`;

/** Instala un FileReader, una Image y un canvas falsos para poder controlar
 *  las dimensiones de origen y el peso de cada candidato. `weight(w, q)` decide
 *  cuánto pesa el data URI que devuelve toDataURL. */
function stubBrowser(opts: {
  width: number;
  height: number;
  weight: (w: number, h: number, q: number) => number;
}) {
  vi.stubGlobal(
    'FileReader',
    class {
      result = '';
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      readAsDataURL() {
        this.result = 'data:application/octet-stream;base64,AAAA';
        this.onload?.();
      }
    },
  );

  vi.stubGlobal(
    'Image',
    class {
      width = opts.width;
      height = opts.height;
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      set src(_v: string) {
        this.onload?.();
      }
    },
  );

  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    drawImage: vi.fn(),
  } as unknown as CanvasRenderingContext2D);

  vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockImplementation(
    function (
      this: HTMLCanvasElement,
      _type?: string,
      quality?: number,
    ): string {
      return dataUri(opts.weight(this.width, this.height, quality ?? 1));
    },
  );
}

/** Presets declarados en core/validators.py (MAX_IMAGE_DATA_URI_BYTES). */
const LIMITE_BACKEND = 256 * 1024;

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('IMAGE_PRESETS', () => {
  it('mantiene cada preset dentro del límite que acepta el backend', () => {
    for (const [name, preset] of Object.entries(IMAGE_PRESETS)) {
      expect(preset.maxBytes, name).toBeLessThanOrEqual(LIMITE_BACKEND);
    }
  });

  it('no deja que un avatar pese más que una foto de vehículo', () => {
    expect(IMAGE_PRESETS.avatar.maxBytes).toBeLessThan(
      IMAGE_PRESETS.grupo.maxBytes,
    );
    expect(IMAGE_PRESETS.grupo.maxBytes).toBeLessThan(
      IMAGE_PRESETS.vehiculo.maxBytes,
    );
  });
});

describe('fileToCompressedDataUri', () => {
  it('no escala hacia arriba una imagen que ya es chica', async () => {
    // 100x80: menor que cualquier preset, tiene que respected tal cual
    stubBrowser({
      width: 100,
      height: 80,
      weight: () => 5 * 1024,
    });

    const result = await fileToCompressedDataUri(new File([], 'chica.jpg'), 'vehiculo');

    expect(result).toBe(dataUri(5 * 1024));
  });

  it('reduce el lado largo al máximo del preset', async () => {
    stubBrowser({
      width: 2000,
      height: 1000,
      weight: () => 5 * 1024,
    });

    await fileToCompressedDataUri(new File([], 'grande.jpg'), 'avatar');

    // avatar: maxSize 320 -> 320x160 (proporción 2:1 conservada)
    const ctx = vi.mocked(HTMLCanvasElement.prototype.getContext);
    const drawImage = ctx.mock.results[0].value.drawImage as ReturnType<
      typeof vi.fn
    >;
    // drawImage(img, dx, dy, dWidth, dHeight)
    const [, , , drawnW, drawnH] = drawImage.mock.calls[0];
    expect(drawnW).toBe(IMAGE_PRESETS.avatar.maxSize);
    expect(drawnH).toBe(IMAGE_PRESETS.avatar.maxSize / 2);
  });

  it('baja la calidad hasta entrar en el presupuesto de bytes', async () => {
    // 300 KB con calidad 0.72 (el primer candidato), pero 20 KB en 0.6
    stubBrowser({
      width: 800,
      height: 800,
      weight: (_w, _h, q) => (q > 0.65 ? 300 * 1024 : 20 * 1024),
    });

    const result = await fileToCompressedDataUri(new File([], 'ruidosa.jpg'), 'vehiculo');

    expect(result.length).toBeLessThanOrEqual(IMAGE_PRESETS.vehiculo.maxBytes);
  });

  it('achica la imagen si bajando la calidad no alcanza', async () => {
    // siempre pesa 300 KB: hay que probar los candidatos escalados (0.8 y 0.65)
    stubBrowser({
      width: 900,
      height: 900,
      weight: (_w, _h, _q) => 300 * 1024,
    });

    const result = await fileToCompressedDataUri(new File([], 'ruidosa.jpg'), 'vehiculo');

    // ningún candidato entra, así que devuelve el primero: pesa de más, pero
    // más vale eso que rechazar la foto del usuario
    expect(result).toBe(dataUri(300 * 1024));
  });

  it('rechaza una imagen que no se puede leer', async () => {
    vi.stubGlobal(
      'FileReader',
      class {
        onload: (() => void) | null = null;
        onerror: (() => void) | null = null;
        readAsDataURL() {
          this.onerror?.();
        }
      },
    );

    await expect(
      fileToCompressedDataUri(new File([], 'rota.jpg'), 'avatar'),
    ).rejects.toThrow('No pudimos leer la imagen');
  });
});
