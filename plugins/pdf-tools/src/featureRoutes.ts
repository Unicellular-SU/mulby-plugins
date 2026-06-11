// 共享：featureCode → route 映射。
// main.ts(后端) 与 App.tsx(前端) 共用此常量，避免两处双写导致漂移。
export const FEATURE_ROUTE_MAP: Record<string, string> = {
    merge: 'merge',
    split: 'split',
    arrange: 'arrange',
    compress: 'compress',
    watermark: 'watermark',
    'extract-img': 'extract-img',
    'pdf-to-img': 'pdf-to-img',
    'pdf-to-word': 'pdf-to-word',
    'pdf-to-ppt': 'pdf-to-ppt',
    'pdf-to-excel': 'pdf-to-excel',
    'web-to-pdf': 'web-to-pdf',
};
