
import { WatermarkSettings, WatermarkType } from '../types';

export const applyWatermark = async (
  base64Image: string,
  settings: WatermarkSettings
): Promise<string> => {
  if (!settings.enabled) return base64Image;

  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.src = base64Image;

    img.onload = async () => {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error("Canvas context not supported"));
        return;
      }

      canvas.width = img.width;
      canvas.height = img.height;

      // Draw original image
      ctx.drawImage(img, 0, 0);

      ctx.globalAlpha = settings.opacity;
      
      if (settings.type === WatermarkType.TEXT_TILED || settings.type === WatermarkType.TEXT_CORNER) {
        // --- TEXT WATERMARK ---
        const text = settings.text || 'HorrorManga';
        const fontSize = Math.max(24, canvas.width * 0.05); // Responsive font size
        ctx.font = `bold ${fontSize}px "Courier New", monospace`;
        ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
        ctx.textBaseline = 'middle';
        ctx.textAlign = 'center';

        if (settings.type === WatermarkType.TEXT_CORNER) {
          ctx.textAlign = 'right';
          ctx.textBaseline = 'bottom';
          ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
          ctx.fillText(text, canvas.width - 20, canvas.height - 20);
        } else {
          // TILED (Diagonal)
          ctx.translate(canvas.width / 2, canvas.height / 2);
          ctx.rotate(-Math.PI / 4);
          ctx.translate(-canvas.width / 2, -canvas.height / 2);

          const gap = fontSize * 6;
          // Draw a grid of text
          // We draw larger than canvas to cover rotation gaps
          for (let x = -canvas.width; x < canvas.width * 2; x += gap) {
            for (let y = -canvas.height; y < canvas.height * 2; y += gap) {
              ctx.fillText(text, x, y);
            }
          }
        }
      } else if (settings.image && (settings.type === WatermarkType.IMAGE_CENTER || settings.type === WatermarkType.IMAGE_CORNER)) {
        // --- IMAGE WATERMARK ---
        const watermarkImg = new Image();
        watermarkImg.src = settings.image;
        
        await new Promise<void>((res) => {
            watermarkImg.onload = () => res();
            watermarkImg.onerror = () => res(); // Skip on error
        });

        const aspectRatio = watermarkImg.width / watermarkImg.height;
        
        if (settings.type === WatermarkType.IMAGE_CENTER) {
          // Center, large
          const w = canvas.width * 0.4;
          const h = w / aspectRatio;
          const x = (canvas.width - w) / 2;
          const y = (canvas.height - h) / 2;
          ctx.drawImage(watermarkImg, x, y, w, h);
        } else {
          // Corner, small
          const w = canvas.width * 0.15;
          const h = w / aspectRatio;
          const x = canvas.width - w - 20;
          const y = canvas.height - h - 20;
          ctx.drawImage(watermarkImg, x, y, w, h);
        }
      }

      resolve(canvas.toDataURL('image/png'));
    };

    img.onerror = (err) => reject(err);
  });
};
