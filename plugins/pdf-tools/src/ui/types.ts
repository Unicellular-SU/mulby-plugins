export interface PDFInfo {
    pageCount: number;
    title: string;
    author: string;
}

export interface SplitRange {
    start: number;
    end: number;
    name: string;
}

export interface WatermarkConfig {
    type: 'text' | 'image';
    text?: string;
    imagePath?: string;
    layout: 'center' | 'tile';
    width?: number;
    height?: number;
    scale?: number;
    opacity: number;
    rotate: number;
    color?: string;
    fontSize?: number;
    gap?: number;
}

export interface PDFPageMeta {
    index: number;
    width: number;
    height: number;
    rotation: number;
}

export interface PDFPageMetaResult {
    pageCount: number;
    pages: PDFPageMeta[];
}

export interface ArrangeCropBox {
    left: number;
    bottom: number;
    width: number;
    height: number;
}

export interface ArrangeCropMargin {
    top: number;
    right: number;
    bottom: number;
    left: number;
}

export interface ArrangeCropConfig {
    mode: 'box' | 'margin';
    unit?: 'ratio' | 'pt';
    box?: ArrangeCropBox;
    margin?: ArrangeCropMargin;
}

export interface ArrangePageInput {
    sourceIndex: number;
    rotate?: number;
    crop?: ArrangeCropConfig;
}

export interface ArrangePDFOptions {
    sourcePath: string;
    pages: ArrangePageInput[];
    extractIndices?: number[];
    outputDir?: string;
    fileName?: string;
    overwriteOriginal?: boolean;
}

export interface ArrangePDFResult {
    outputPath: string;
    pageCount: number;
    overwritten: boolean;
}

declare global {
    interface Window {
        pdfApi?: {
            // I/O Utils
            readFile: (path: string) => Promise<Uint8Array>;
            saveFile: (path: string, data: Uint8Array) => Promise<string>;
            saveTempFileFromDrop: (fileName: string, data: Uint8Array) => Promise<string>;
            ensureDir: (path: string) => Promise<void>;
            joinPath: (...parts: string[]) => string;
            openPath: (path: string) => Promise<void>;

            // Node-side PDF Lib operations (Non-rendering)
            getPDFInfo: (path: string) => Promise<PDFInfo>;
            getPDFPageMeta: (path: string) => Promise<PDFPageMetaResult>;
            getFileSize: (path: string) => Promise<number>;
            getPDFImagePreview: (path: string) => Promise<string | null>;
            extractPDFImages: (path: string, outputDir: string) => Promise<string[]>;
            splitPDFByPage: (path: string, outputDir: string, prefix?: string) => Promise<string[]>;
            splitPDFByRanges: (path: string, ranges: SplitRange[], outputDir: string) => Promise<string[]>;
            mergePDFs: (files: string[], outputDir: string, fileName?: string) => Promise<string>;
            watermarkPDF: (path: string, config: WatermarkConfig, outputDir: string) => Promise<string>;
            arrangePDF: (options: ArrangePDFOptions) => Promise<ArrangePDFResult>;
        };

    }
}
