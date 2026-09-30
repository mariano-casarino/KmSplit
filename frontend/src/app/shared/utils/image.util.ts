/**
 * Lee un archivo de imagen elegido por el usuario, lo redimensiona y lo
 * convierte a JPEG base64 (data URI), para guardarlo en la base y que
 * funcione en `<img src>` en cualquier navegador incluido iOS/Safari.
 *
 * OJO CON EL TAMAÑO: estas fotos NO van en un <img> aparte, viajan dentro de
 * cada respuesta de la API. El avatar va en /auth/me, en el grupo y en cada
 * miembro del dashboard del vehículo, así que un avatar de 200 KB se vuelve a
 * descargar en todas las pantallas. Por eso los presets son deliberadamente
 * chicos: un avatar queda en ~10-20 KB y una foto de vehículo en ~80 KB, y el
 * payload de una pantalla de detalle baja de ~700 KB a ~100 KB.
 *
 * Para las fotos que ya están guardadas muy grandes: `python manage.py
 * recompress_images` (ver core/management/commands/).
 */

export type ImagePreset = 'avatar' | 'grupo' | 'vehiculo';

interface Preset {
  /** lado máximo en px (no escalamos hacia arriba) */
  maxSize: number;
  /** calidad JPEG inicial */
  quality: number;
  /** presupuesto máximo del data URI en bytes */
  maxBytes: number;
}

export const IMAGE_PRESETS: Record<ImagePreset, Preset> = {
  avatar: { maxSize: 320, quality: 0.72, maxBytes: 40 * 1024 },
  grupo: { maxSize: 480, quality: 0.72, maxBytes: 80 * 1024 },
  vehiculo: { maxSize: 900, quality: 0.72, maxBytes: 180 * 1024 },
};

export function fileToCompressedDataUri(
  file: File,
  preset: ImagePreset = 'avatar',
): Promise<string> {
  const { maxSize, quality, maxBytes } = IMAGE_PRESETS[preset];
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('No pudimos leer la imagen'));
    reader.onload = () => {
      const src = reader.result as string;
      const img = new Image();
      img.onerror = () => reject(new Error('La imagen no es válida'));
      img.onload = () => {
        // no escalamos hacia arriba: si es más chica, la dejamos como está
        let { width, height } = img;
        const longest = Math.max(width, height);
        if (longest > maxSize) {
          const scale = maxSize / longest;
          width = Math.round(width * scale);
          height = Math.round(height * scale);
        }

        const draw = (w: number, h: number, q: number): string => {
          const canvas = document.createElement('canvas');
          canvas.width = w;
          canvas.height = h;
          const ctx = canvas.getContext('2d')!;
          ctx.drawImage(img, 0, 0, w, h);
          return canvas.toDataURL('image/jpeg', q);
        };

        // bajamos la calidad hasta entrar en el presupuesto y, si con calidad
        // no alcanza, achicamos un poco más la imagen
        const candidates: string[] = [quality, 0.6, 0.5, 0.4].map((q) =>
          draw(width, height, q),
        );
        for (const factor of [0.8, 0.65]) {
          candidates.push(
            draw(Math.round(width * factor), Math.round(height * factor), 0.5),
          );
        }

        // si ni así entra (imagen muy ruidosa), va la primera: pesa un poco más
        // de lo ideal pero se ve bien y no vale la pena rechazarla
        resolve(candidates.find((c) => c.length <= maxBytes) ?? candidates[0]);
      };
      img.src = src;
    };
    reader.readAsDataURL(file);
  });
}
