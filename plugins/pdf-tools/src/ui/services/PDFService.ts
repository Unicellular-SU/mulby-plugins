import * as pdfjsLib from 'pdfjs-dist';
// @ts-ignore
import pdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { Document, Packer, Paragraph, TextRun, ImageRun } from 'docx';
import { PDFDocument } from 'pdf-lib';
import PptxGenJS from 'pptxgenjs';
import * as XLSX from 'xlsx';

// Set up the worker for PDF.js
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorker;

// Helper to get window.pdfApi
const getApi = () => {
    // @ts-ignore
    const api = window.pdfApi;
    if (!api) throw new Error('PDF API is not available on window object');
    return api;
};

// Types corresponding to what we are generating
export interface ConversionProgress {
    current: number;
    total: number;
    status: string;
}

export type ProgressCallback = (progress: ConversionProgress) => void;

class PDFService {
    async getDocument(pdfPath: string) {
        try {
            const api = getApi();
            const data = await api.readFile(pdfPath);
            // data from Electron preload is typically Uint8Array in renderer
            return await pdfjsLib.getDocument({
                data: data,
                cMapUrl: 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.4.168/cmaps/',
                cMapPacked: true, // true? or removed in v4? It was true in v3/v4.
            }).promise;
        } catch (e: any) {
            console.error('Failed to load PDF:', e);
            throw new Error(`无法加载PDF文件: ${e.message}`);
        }
    }

    /**
     * 提取 PDF 中的内嵌图片
     */
    async extractImages(pdfPath: string, outputDir: string, onProgress?: ProgressCallback): Promise<string[]> {
        const api = getApi();

        // 使用后端提取（直接从流中提取图片）
        // @ts-ignore
        if (api.extractPDFImages) {
            if (onProgress) onProgress({ current: 0, total: 100, status: '正在通过后端提取图片...' });
            // @ts-ignore
            const results = await api.extractPDFImages(pdfPath, outputDir);
            if (results) return results;
        }

        console.warn('Backend extractPDFImages non-existent');
        return [];
    }

    /**
     * 将 PDF 每一页渲染为图片 (PDF 转图片)
     */
    async convertPDFToImages(pdfPath: string, outputDir: string, onProgress?: ProgressCallback): Promise<string[]> {
        const api = getApi();
        await api.ensureDir(outputDir);

        const pdf = await this.getDocument(pdfPath);
        const totalPages = pdf.numPages;
        const outputPaths: string[] = [];

        console.log(`Starting PDF to Image conversion. Pages: ${totalPages}`);

        for (let i = 1; i <= totalPages; i++) {
            if (onProgress) {
                onProgress({ current: i, total: totalPages, status: `正在转换第 ${i} 页...` });
            }

            const page = await pdf.getPage(i);
            const viewport = page.getViewport({ scale: 2.0 }); // High quality

            const canvas = document.createElement('canvas');
            canvas.width = viewport.width;
            canvas.height = viewport.height;
            const context = canvas.getContext('2d');

            if (!context) throw new Error('Canvas context could not be created');

            // Set white background
            context.fillStyle = '#ffffff';
            context.fillRect(0, 0, canvas.width, canvas.height);

            // Render configuration
            const renderContext = {
                canvasContext: context,
                viewport: viewport,
                // Ensure watermarks and annotations are rendered
                // @ts-ignore - AnnotationMode might not be exported in types but exists in runtime or needs explicit value 1
                annotationMode: 1, // ENABLE
                includeHidden: false,
            } as any;

            try {
                await page.render(renderContext).promise;
            } catch (renderError) {
                console.error(`Error rendering page ${i}:`, renderError);
            }

            const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/png'));
            if (!blob) throw new Error('Image creation failed');

            const buffer = await blob.arrayBuffer();

            // Path handling
            const fileName = `page_${i.toString().padStart(3, '0')}.png`; // Pad numbers for ordering
            const isWindows = outputDir.includes('\\');
            const separator = isWindows ? '\\' : '/';
            const cleanDir = outputDir.endsWith(separator) ? outputDir.slice(0, -1) : outputDir;
            const finalPath = `${cleanDir}${separator}${fileName}`;

            await api.saveFile(finalPath, new Uint8Array(buffer));
            outputPaths.push(finalPath);
        }

        return outputPaths;
    }

    async getThumbnail(pdfPath: string): Promise<string | null> {
        const api = getApi();
        try {
            // @ts-ignore
            if (api.getPDFImagePreview) {
                // @ts-ignore
                const preview = await api.getPDFImagePreview(pdfPath);
                if (preview) return preview;
            }
        } catch (e) {
            console.warn('Backend preview failed', e);
        }

        // Fallback
        try {
            return await this.renderPageToDataURL(pdfPath, 1, 0.2);
        } catch (e) {
            console.error('Fallback preview failed', e);
            return null;
        }
    }

    async convertToWord(pdfPath: string, outputDir: string): Promise<string> {
        const api = getApi();
        await api.ensureDir(outputDir);

        const pdf = await this.getDocument(pdfPath);
        const children = [];

        for (let i = 1; i <= pdf.numPages; i++) {
            const page = await pdf.getPage(i);
            const textContent = await page.getTextContent();
            const strings = textContent.items.map((item: any) => item.str).join(' ');

            // Check if page has text content
            if (strings.trim().length > 0) {
                children.push(
                    new Paragraph({
                        children: [new TextRun(strings)],
                    }),
                    new Paragraph({ text: "", pageBreakBefore: true })
                );
            } else {
                // Fallback: Render page as image for scanned PDFs
                console.log(`Page ${i} has no text, rendering as image...`);
                const viewport = page.getViewport({ scale: 2.0 });
                const canvas = document.createElement('canvas');
                canvas.width = viewport.width;
                canvas.height = viewport.height;
                const context = canvas.getContext('2d');

                if (context) {
                    const renderContext = {
                        canvasContext: context,
                        viewport: viewport,
                    } as any;
                    await page.render(renderContext).promise;

                    const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/png'));
                    if (blob) {
                        const buffer = await blob.arrayBuffer();
                        children.push(
                            new Paragraph({
                                children: [
                                    new ImageRun({
                                        data: buffer,
                                        transformation: {
                                            width: viewport.width / 2,
                                            height: viewport.height / 2,
                                        },
                                        type: "png",
                                    }),
                                ],
                            }),
                            new Paragraph({ text: "", pageBreakBefore: true }) // Add page break after image
                        );
                    }
                }
            }
        }

        const doc = new Document({ sections: [{ children }] });
        const buffer = await Packer.toBuffer(doc);

        // Construct filename
        // Basic path parsing
        const fileName = pdfPath.split(/[/\\]/).pop()?.replace('.pdf', '.docx') || 'converted.docx';
        const isWindows = outputDir.includes('\\');
        const separator = isWindows ? '\\' : '/';
        const cleanDir = outputDir.endsWith(separator) ? outputDir.slice(0, -1) : outputDir;
        const outputPath = `${cleanDir}${separator}${fileName}`;

        await api.saveFile(outputPath, new Uint8Array(buffer));
        return outputPath;
    }

    async convertToPPT(pdfPath: string, outputDir: string): Promise<string> {
        const api = getApi();
        await api.ensureDir(outputDir);

        const pdf = await this.getDocument(pdfPath);
        const pptx = new PptxGenJS();

        for (let i = 1; i <= pdf.numPages; i++) {
            const page = await pdf.getPage(i);
            const textContent = await page.getTextContent();
            const strings = textContent.items.map((item: any) => item.str).join(' ');

            const slide = pptx.addSlide();

            // Check if page has text content
            if (strings.trim().length > 0) {
                slide.addText(strings, { x: 0.5, y: 0.5, w: '90%', h: '90%', fontSize: 14 });
            } else {
                // Fallback: Render page as image for scanned PDFs
                console.log(`Page ${i} has no text, rendering as image...`);
                const viewport = page.getViewport({ scale: 2.0 });
                const canvas = document.createElement('canvas');
                canvas.width = viewport.width;
                canvas.height = viewport.height;
                const context = canvas.getContext('2d');

                if (context) {
                    const renderContext = {
                        canvasContext: context,
                        viewport: viewport,
                    } as any;
                    await page.render(renderContext).promise;

                    const dataUrl = canvas.toDataURL('image/png');
                    // PptxGenJS addImage expects base64 string or URL
                    slide.addImage({
                        data: dataUrl,
                        x: 0.5,
                        y: 0.5,
                        w: pptx.presLayout.width - 1, // Adjust width to fit slide, -1 for padding
                        h: pptx.presLayout.height - 1, // Adjust height to fit slide, -1 for padding
                        sizing: { type: 'contain', w: pptx.presLayout.width - 1, h: pptx.presLayout.height - 1 }
                    });
                }
            }
        }

        // Generate Blob
        const data = await pptx.write({ outputType: 'arraybuffer' }) as ArrayBuffer;

        const fileName = pdfPath.split(/[/\\]/).pop()?.replace('.pdf', '.pptx') || 'converted.pptx';
        const isWindows = outputDir.includes('\\');
        const separator = isWindows ? '\\' : '/';
        const cleanDir = outputDir.endsWith(separator) ? outputDir.slice(0, -1) : outputDir;
        const outputPath = `${cleanDir}${separator}${fileName}`;

        await api.saveFile(outputPath, new Uint8Array(data));
        return outputPath;
    }

    async convertToExcel(pdfPath: string, outputDir: string): Promise<string> {
        const api = getApi();
        await api.ensureDir(outputDir);

        const pdf = await this.getDocument(pdfPath);
        const rows = [];

        for (let i = 1; i <= pdf.numPages; i++) {
            const page = await pdf.getPage(i);
            const textContent = await page.getTextContent();
            const strings = textContent.items.map((item: any) => item.str);
            rows.push(strings);
        }

        const wb = XLSX.utils.book_new();
        const ws = XLSX.utils.aoa_to_sheet(rows);
        XLSX.utils.book_append_sheet(wb, ws, "PDF Data");

        // Write to buffer
        const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });

        const fileName = pdfPath.split(/[/\\]/).pop()?.replace('.pdf', '.xlsx') || 'converted.xlsx';
        const isWindows = outputDir.includes('\\');
        const separator = isWindows ? '\\' : '/';
        const cleanDir = outputDir.endsWith(separator) ? outputDir.slice(0, -1) : outputDir;
        const outputPath = `${cleanDir}${separator}${fileName}`;

        await api.saveFile(outputPath, new Uint8Array(wbout));
        return outputPath;
    }
    async getPageCount(pdfPath: string): Promise<number> {
        const pdf = await this.getDocument(pdfPath);
        return pdf.numPages;
    }

    async getFileSize(filePath: string): Promise<number> {
        const api = getApi();
        // @ts-ignore
        if (api.getFileSize) {
            // @ts-ignore
            return await api.getFileSize(filePath);
        }
        return 0;
    }

    async renderPageToDataURL(pdfPath: string, pageNum: number, scale = 0.5): Promise<string> {
        const pdf = await this.getDocument(pdfPath);
        const page = await pdf.getPage(pageNum);
        const viewport = page.getViewport({ scale });

        const canvas = document.createElement('canvas');
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        const context = canvas.getContext('2d');

        if (!context) throw new Error('Canvas context missing');

        const renderContext = {
            canvasContext: context,
            viewport: viewport,
        } as any;
        await page.render(renderContext).promise;

        return canvas.toDataURL('image/png');
    }

    /**
     * 分析 PDF 类型，判断是否适合光栅化压缩
     * 返回: { isTextBased: boolean, totalTextChars: number, estimatedImagePages: number }
     */
    private async analyzePDFType(pdf: any): Promise<{ isTextBased: boolean; totalTextChars: number; imagePageCount: number }> {
        const totalPages = pdf.numPages;
        let totalTextChars = 0;
        let imagePageCount = 0;

        for (let i = 1; i <= totalPages; i++) {
            const page = await pdf.getPage(i);
            try {
                const textContent = await page.getTextContent();
                const pageTextLength = textContent.items.reduce((acc: number, item: any) => acc + (item.str?.length || 0), 0);
                totalTextChars += pageTextLength;

                // 如果页面文本少于 50 字符，可能是图片页
                if (pageTextLength < 50) {
                    imagePageCount++;
                }
            } catch (e) {
                // 无法提取文本，假设是图片页
                imagePageCount++;
            }
        }

        // 如果总文本量大且图片页占比小于 30%，认为是文本型 PDF
        const imageRatio = imagePageCount / totalPages;
        const isTextBased = totalTextChars > 500 && imageRatio < 0.3;

        return { isTextBased, totalTextChars, imagePageCount };
    }

    /**
     * 压缩 PDF - 智能策略
     * 
     * 策略：
     * 1. 首先分析 PDF 类型（文本型 vs 图片型）
     * 2. 文本型 PDF：使用 pdf-lib 内置优化，不光栅化
     * 3. 图片型 PDF：执行光栅化压缩
     * 4. 终极兜底：如果压缩后体积 >= 原体积，返回原文件
     */
    async compressPDF(pdfPath: string, outputDir: string, quality: number = 0.6, onProgress?: ProgressCallback): Promise<string> {
        const api = getApi();
        await api.ensureDir(outputDir);

        // 读取原始文件
        const originPdfBytes = await api.readFile(pdfPath);
        const originalFileSize = originPdfBytes.length;

        if (onProgress) {
            onProgress({ current: 0, total: 100, status: '正在分析 PDF 类型...' });
        }

        const pdf = await this.getDocument(pdfPath);
        const totalPages = pdf.numPages;

        // 步骤1：分析 PDF 类型
        const analysis = await this.analyzePDFType(pdf);
        console.log(`PDF Analysis: TextBased=${analysis.isTextBased}, TotalText=${analysis.totalTextChars}, ImagePages=${analysis.imagePageCount}/${totalPages}`);

        let compressedBytes: Uint8Array;

        if (analysis.isTextBased) {
            // 文本型 PDF：使用 pdf-lib 内置优化，不进行光栅化
            if (onProgress) {
                onProgress({ current: 50, total: 100, status: '文本型 PDF，使用内置优化...' });
            }
            console.log('Text-based PDF detected. Using pdf-lib optimization instead of rasterization.');

            // pdf-lib 优化：使用对象流压缩
            const pdfDoc = await PDFDocument.load(originPdfBytes);
            compressedBytes = await pdfDoc.save({
                useObjectStreams: true, // 启用对象流压缩
            });
        } else {
            // 图片型 PDF：执行光栅化压缩
            if (onProgress) {
                onProgress({ current: 10, total: 100, status: '图片型 PDF，开始光栅化压缩...' });
            }
            console.log('Image-based PDF detected. Using rasterization compression.');

            const originalPdfDoc = await PDFDocument.load(originPdfBytes);
            const newDoc = await PDFDocument.create();

            for (let i = 1; i <= totalPages; i++) {
                if (onProgress) {
                    const progress = 10 + Math.floor((i / totalPages) * 80);
                    onProgress({ current: progress, total: 100, status: `正在压缩第 ${i}/${totalPages} 页...` });
                }

                const page = await pdf.getPage(i);
                const originalViewport = page.getViewport({ scale: 1.0 });

                // 渲染尺寸限制
                let scale = 1.5;
                const maxDim = Math.max(originalViewport.width, originalViewport.height);
                if (maxDim * scale > 1500) {
                    scale = 1500 / maxDim;
                }
                if (quality <= 0.5) scale *= 0.8;

                const viewport = page.getViewport({ scale });

                const canvas = document.createElement('canvas');
                canvas.width = viewport.width;
                canvas.height = viewport.height;
                const context = canvas.getContext('2d');

                if (!context) {
                    // 无法创建 canvas，复制原页
                    const [copiedPage] = await newDoc.copyPages(originalPdfDoc, [i - 1]);
                    newDoc.addPage(copiedPage);
                    continue;
                }

                context.fillStyle = '#ffffff';
                context.fillRect(0, 0, canvas.width, canvas.height);

                const renderContext = {
                    canvasContext: context,
                    viewport: viewport,
                    annotationMode: 1,
                    includeHidden: false,
                } as any;

                try {
                    await page.render(renderContext).promise;
                } catch (err) {
                    console.error(`Page ${i}: Render error`, err);
                    const [copiedPage] = await newDoc.copyPages(originalPdfDoc, [i - 1]);
                    newDoc.addPage(copiedPage);
                    continue;
                }

                const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/jpeg', quality));

                if (!blob) {
                    const [copiedPage] = await newDoc.copyPages(originalPdfDoc, [i - 1]);
                    newDoc.addPage(copiedPage);
                    continue;
                }

                const buffer = await blob.arrayBuffer();
                const embeddedImage = await newDoc.embedJpg(buffer);

                // 使用原始页面尺寸
                const newPage = newDoc.addPage([originalViewport.width, originalViewport.height]);
                newPage.drawImage(embeddedImage, {
                    x: 0,
                    y: 0,
                    width: originalViewport.width,
                    height: originalViewport.height,
                });
            }

            compressedBytes = await newDoc.save({ useObjectStreams: true });
        }

        if (onProgress) {
            onProgress({ current: 95, total: 100, status: '正在验证压缩结果...' });
        }

        // 步骤2：终极兜底检查
        const compressionRatio = compressedBytes.length / originalFileSize;
        console.log(`Compression result: Original=${originalFileSize}, Compressed=${compressedBytes.length}, Ratio=${(compressionRatio * 100).toFixed(1)}%`);

        let finalBytes: Uint8Array;
        let compressionSucceeded: boolean;

        if (compressedBytes.length >= originalFileSize) {
            // 压缩失败（体积没有减小），返回原文件
            console.warn('Compression did not reduce file size. Returning original file.');
            finalBytes = originPdfBytes;
            compressionSucceeded = false;
        } else {
            finalBytes = compressedBytes;
            compressionSucceeded = true;
        }

        // 构造文件名
        const suffix = compressionSucceeded ? '_compressed.pdf' : '_original_copy.pdf';
        const fileName = pdfPath.split(/[/\\]/).pop()?.replace('.pdf', suffix) || 'result.pdf';
        const isWindows = outputDir.includes('\\');
        const separator = isWindows ? '\\' : '/';
        const cleanDir = outputDir.endsWith(separator) ? outputDir.slice(0, -1) : outputDir;
        const outputPath = `${cleanDir}${separator}${fileName}`;

        await api.saveFile(outputPath, finalBytes);

        if (onProgress) {
            onProgress({ current: 100, total: 100, status: compressionSucceeded ? '压缩完成' : '无法进一步压缩，已保存原文件' });
        }

        return outputPath;
    }
}

export const pdfService = new PDFService();
