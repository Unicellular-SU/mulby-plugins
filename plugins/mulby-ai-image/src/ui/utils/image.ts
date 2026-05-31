export const convertToSupportedBuffer = (file: File): Promise<{ buffer: ArrayBuffer, mimeType: string }> => {
  return new Promise((resolve, reject) => {
    const supportedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
    if (supportedTypes.includes(file.type)) {
      file.arrayBuffer().then(buffer => resolve({ buffer, mimeType: file.type })).catch(reject);
      return;
    }

    // Convert unsupported image to PNG
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d');
      if (!ctx) return reject(new Error('Failed to get canvas context'));
      ctx.drawImage(img, 0, 0);
      canvas.toBlob((blob) => {
        if (!blob) return reject(new Error('Canvas toBlob failed'));
        blob.arrayBuffer().then(buffer => resolve({ buffer, mimeType: 'image/png' })).catch(reject);
      }, 'image/png');
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('无法解析或转换该图片格式，请尝试上传 PNG 或 JPG'));
    };
    img.src = url;
  });
};
