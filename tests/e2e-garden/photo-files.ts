import type { Page } from '@playwright/test';

export interface UploadFile {
  name: string;
  mimeType: string;
  buffer: Buffer;
}

/** JPEG reales generados en el navegador (la página ya debe estar cargada). */
export async function jpegFiles(
  page: Page,
  count: number,
  width = 1200,
  height = 800,
): Promise<UploadFile[]> {
  const encoded = await page.evaluate(
    async ({ count, width, height }) => {
      const out: string[] = [];
      for (let i = 0; i < count; i++) {
        const c = document.createElement('canvas');
        c.width = width;
        c.height = height;
        const ctx = c.getContext('2d');
        if (!ctx) throw new Error('ctx');
        ctx.fillStyle = `hsl(${(i * 53) % 360} 60% 70%)`;
        ctx.fillRect(0, 0, width, height);
        ctx.fillStyle = '#fff';
        ctx.fillRect(width / 10, height / 10, width / 5, height / 5);
        const blob = await new Promise<Blob | null>((r) => c.toBlob(r, 'image/jpeg', 0.9));
        if (!blob) throw new Error('toBlob');
        const bytes = new Uint8Array(await blob.arrayBuffer());
        let s = '';
        for (let j = 0; j < bytes.length; j += 8192)
          s += String.fromCharCode(...bytes.subarray(j, j + 8192));
        out.push(btoa(s));
      }
      return out;
    },
    { count, width, height },
  );
  return encoded.map((b64, i) => ({
    name: `foto-${i + 1}.jpg`,
    mimeType: 'image/jpeg',
    buffer: Buffer.from(b64, 'base64'),
  }));
}

/** Un «.jpg» que en realidad es un SVG con script. */
export const badFile: UploadFile = {
  name: 'falsa.jpg',
  mimeType: 'image/jpeg',
  buffer: Buffer.from('<svg><script>alert(1)</script></svg>'),
};
