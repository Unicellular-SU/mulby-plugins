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

export type WebToPdfSource =
    | { kind: 'url'; url: string }
    | { kind: 'html'; html: string }
    | { kind: 'file'; path: string };

export interface WebToPdfOptions {
    source: WebToPdfSource;
    /** Electron.PrintToPDFOptions（pageSize/landscape/margins/scale/printBackground/preferCSSPageSize 等） */
    pdfOptions?: Record<string, unknown>;
    viewportWidth?: number;
    viewportHeight?: number;
    /** 固定等待毫秒数（与 waitSelector 二选一） */
    waitMs?: number;
    /** 等待某个选择器出现后再打印（应对动态/懒加载页面） */
    waitSelector?: string;
    /** 自动滚动到底触发懒加载资源 */
    autoScroll?: boolean;
    /** 导航超时（毫秒） */
    timeout?: number;
    outputDir: string;
    fileName: string;
}

// 在页面上下文执行：分步滚动到底以触发懒加载，再回到顶部
const AUTO_SCROLL_SCRIPT = () => {
    return new Promise<void>((resolve) => {
        try {
            let scrolled = 0;
            const distance = 600;
            const start = Date.now();
            const maxTime = 8000;
            const timer = setInterval(() => {
                const scrollHeight = document.body.scrollHeight;
                window.scrollBy(0, distance);
                scrolled += distance;
                if (scrolled >= scrollHeight - window.innerHeight || Date.now() - start > maxTime) {
                    clearInterval(timer);
                    window.scrollTo(0, 0);
                    setTimeout(() => resolve(), 300);
                }
            }, 120);
        } catch {
            resolve();
        }
    });
};

class PDFService {
    private static readonly MAX_DOCUMENT_CACHE = 4;
    private static readonly MAX_THUMBNAIL_CACHE = 120;
    private documentCache = new Map<string, Promise<any>>();
    private thumbnailCache = new Map<string, string>();

    private extractFileName(filePath: string): string {
        return filePath.split(/[/\\]/).pop() || '';
    }

    private replacePdfSuffix(filePath: string, nextSuffix: string): string {
        const name = this.extractFileName(filePath);
        return name.toLowerCase().endsWith('.pdf')
            ? `${name.slice(0, -4)}${nextSuffix}`
            : `converted${nextSuffix}`;
    }

    private async joinOutputPath(outputDir: string, fileName: string): Promise<string> {
        const api = getApi();
        if (typeof api.joinPath === 'function') {
            return api.joinPath(outputDir, fileName);
        }
        const normalizedDir = outputDir.replace(/[\\/]+$/, '');
        return `${normalizedDir}/${fileName}`;
    }

    private pruneDocumentCache() {
        while (this.documentCache.size > PDFService.MAX_DOCUMENT_CACHE) {
            const oldestKey = this.documentCache.keys().next().value as string | undefined;
            if (!oldestKey) break;
            this.documentCache.delete(oldestKey);
        }
    }

    private pruneThumbnailCache() {
        while (this.thumbnailCache.size > PDFService.MAX_THUMBNAIL_CACHE) {
            const oldestKey = this.thumbnailCache.keys().next().value as string | undefined;
            if (!oldestKey) break;
            this.thumbnailCache.delete(oldestKey);
        }
    }

    async getDocument(pdfPath: string) {
        const cachedPromise = this.documentCache.get(pdfPath);
        if (cachedPromise) return cachedPromise;

        const loader = (async () => {
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
        })();

        this.documentCache.set(pdfPath, loader);
        this.pruneDocumentCache();

        try {
            return await loader;
        } catch (e) {
            this.documentCache.delete(pdfPath);
            throw e;
        }
    }

    /**
     * 提取 PDF 中的内嵌图片
     */
    async extractImages(pdfPath: string, outputDir: string, onProgress?: ProgressCallback): Promise<string[]> {
        const api = getApi();

        // 使用后端提取（直接从流中提取图片）
        if (api.extractPDFImages) {
            if (onProgress) onProgress({ current: 0, total: 100, status: '正在通过后端提取图片...' });
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

            const fileName = `page_${i.toString().padStart(3, '0')}.png`;
            const finalPath = await this.joinOutputPath(outputDir, fileName);

            await api.saveFile(finalPath, new Uint8Array(buffer));
            outputPaths.push(finalPath);
        }

        return outputPaths;
    }

    async getThumbnail(pdfPath: string): Promise<string | null> {
        const api = getApi();
        try {
            if (api.getPDFImagePreview) {
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

        const fileName = this.replacePdfSuffix(pdfPath, '.docx');
        const outputPath = await this.joinOutputPath(outputDir, fileName);

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

        const fileName = this.replacePdfSuffix(pdfPath, '.pptx');
        const outputPath = await this.joinOutputPath(outputDir, fileName);

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

        const fileName = this.replacePdfSuffix(pdfPath, '.xlsx');
        const outputPath = await this.joinOutputPath(outputDir, fileName);

        await api.saveFile(outputPath, new Uint8Array(wbout));
        return outputPath;
    }
    async getPageCount(pdfPath: string): Promise<number> {
        const pdf = await this.getDocument(pdfPath);
        return pdf.numPages;
    }

    async getFileSize(filePath: string): Promise<number> {
        const api = getApi();
        if (api.getFileSize) {
            return await api.getFileSize(filePath);
        }
        return 0;
    }

    async renderPageToDataURL(pdfPath: string, pageNum: number, scale = 0.5, rotation = 0): Promise<string> {
        const normalizedRotation = ((Math.round(rotation / 90) * 90) % 360 + 360) % 360;
        const cacheKey = `${pdfPath}::${pageNum}::${scale}::${normalizedRotation}`;
        const cached = this.thumbnailCache.get(cacheKey);
        if (cached) return cached;

        const pdf = await this.getDocument(pdfPath);
        const page = await pdf.getPage(pageNum);
        const viewport = page.getViewport({ scale, rotation: normalizedRotation });

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

        const dataUrl = canvas.toDataURL('image/png');
        this.thumbnailCache.set(cacheKey, dataUrl);
        this.pruneThumbnailCache();
        return dataUrl;
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
        const fileName = this.replacePdfSuffix(pdfPath, suffix);
        const outputPath = await this.joinOutputPath(outputDir, fileName);

        await api.saveFile(outputPath, finalBytes);

        if (onProgress) {
            onProgress({ current: 100, total: 100, status: compressionSucceeded ? '压缩完成' : '无法进一步压缩，已保存原文件' });
        }

        return outputPath;
    }

    /**
     * 网址 / HTML / 本地 HTML 文件 转 PDF
     * 基于 Mulby inbrowser（底层 Electron printToPDF），渲染后输出 PDF。
     */
    async webToPdf(options: WebToPdfOptions): Promise<string> {
        const api = getApi();
        const mulby = (window as any).mulby;
        const inbrowser = mulby?.inbrowser;
        if (!inbrowser || typeof inbrowser.goto !== 'function') {
            throw new Error('当前环境不支持网页转 PDF（inbrowser 不可用）');
        }

        // 1. 归一化为可加载 URL
        let targetUrl: string;
        const { source } = options;
        if (source.kind === 'url') {
            targetUrl = this.normalizeWebUrl(source.url);
        } else if (source.kind === 'file') {
            targetUrl = typeof api.pathToFileUrl === 'function'
                ? api.pathToFileUrl(source.path)
                : `file://${source.path}`;
        } else {
            const html = source.html?.trim();
            if (!html) throw new Error('请输入 HTML 内容');
            targetUrl = await api.saveTempHtml(source.html);
        }

        // 2. 构建链式渲染指令
        const vw = options.viewportWidth ?? 1280;
        const vh = options.viewportHeight ?? 1800;
        const timeout = options.timeout ?? 30000;

        let chain: any = inbrowser.goto(targetUrl, {}, timeout).viewport(vw, vh);
        if (options.autoScroll) {
            chain = chain.evaluate(AUTO_SCROLL_SCRIPT);
        }
        const selector = options.waitSelector?.trim();
        if (selector) {
            chain = chain.wait(selector);
        } else if (options.waitMs && options.waitMs > 0) {
            chain = chain.wait(options.waitMs);
        }
        chain = chain.pdf(options.pdfOptions ?? { printBackground: true, pageSize: 'A4' });

        // 3. 执行（不传 savePath，拿回 PDF 字节）
        const results: unknown[] = await chain.run({
            show: false,
            width: vw,
            height: Math.min(vh, 2000),
            backgroundColor: '#ffffff',
        });

        const bytes = this.pickPdfBytes(results);
        if (!bytes || bytes.length === 0) {
            throw new Error('生成 PDF 失败：未获取到 PDF 数据');
        }

        // 4. 写入下载目录（唯一命名 + 权限回退）
        return api.savePdfBuffer(options.outputDir, options.fileName, bytes);
    }

    private normalizeWebUrl(raw: string): string {
        const trimmed = (raw || '').trim();
        if (!trimmed) throw new Error('请输入有效的网址');
        if (/^(https?|file):\/\//i.test(trimmed)) return trimmed;
        return `https://${trimmed}`;
    }

    private pickPdfBytes(results: unknown[]): Uint8Array | null {
        if (Array.isArray(results)) {
            for (let i = results.length - 1; i >= 0; i--) {
                const u = this.toUint8(results[i]);
                if (u && u.length > 0) return u;
            }
            return null;
        }
        return this.toUint8(results);
    }

    private toUint8(value: any): Uint8Array | null {
        if (!value) return null;
        if (value instanceof Uint8Array) return value;
        if (value instanceof ArrayBuffer) return new Uint8Array(value);
        if (ArrayBuffer.isView(value)) {
            return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
        }
        if (Array.isArray(value)) {
            return value.every((n) => typeof n === 'number') ? Uint8Array.from(value) : null;
        }
        if (typeof value === 'object' && value.type === 'Buffer' && Array.isArray(value.data)) {
            return Uint8Array.from(value.data);
        }
        return null;
    }
}

export const pdfService = new PDFService();
