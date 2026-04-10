// preload.cjs - PDF 处理 API
// 使用 CommonJS 格式，放在项目根目录，不需要打包

const { PDFDocument, degrees, rgb, StandardFonts, PDFName, PDFDict, PDFRawStream } = require('pdf-lib');
const fs = require('fs');
const fsPromises = fs.promises;
const path = require('path');
const os = require('os');
const { Document, Packer, Paragraph, TextRun } = require('docx');
const PptxGenJS = require('pptxgenjs');
const XLSX = require('xlsx');

// Sync File Logger
const logPath = path.join(__dirname, 'debug.log');

function logToFile(message) {
    try {
        const timestamp = new Date().toISOString();
        const logLine = `[${timestamp}] ${message}\n`;
        fs.appendFileSync(logPath, logLine);
    } catch (e) {
        // ignore logging error
    }
}

// Global Error Handlers
process.on('uncaughtException', (err) => {
    logToFile(`[Uncaught Exception] ${err.stack || err}`);
});

// 暴露 PDF 处理 API 给渲染进程
window.pdfApi = {
    // === 文件 I/O 基础能力 ===
    readFile: async (filePath) => {
        try {
            return await fsPromises.readFile(filePath);
        } catch (error) {
            throw new Error(`读取文件失败: ${error.message}`);
        }
    },

    saveFile: async (filePath, data) => {
        try {
            // Ensure directory exists
            await fsPromises.mkdir(path.dirname(filePath), { recursive: true });
            await fsPromises.writeFile(filePath, data);
            return filePath;
        } catch (error) {
            throw new Error(`保存文件失败: ${error.message}`);
        }
    },

    saveTempFileFromDrop: async (fileName, data) => {
        try {
            const safeName = String(fileName || 'dropped.pdf').replace(/[^\w.\-()\u4e00-\u9fa5]/g, '_');
            const ext = path.extname(safeName).toLowerCase();
            const base = ext ? safeName.slice(0, -ext.length) : safeName;
            const finalName = `${base || 'dropped'}${ext || '.pdf'}`;
            const dir = path.join(os.tmpdir(), 'mulby-pdf-tools-drop');
            await fsPromises.mkdir(dir, { recursive: true });
            const tempPath = path.join(dir, `${Date.now()}_${Math.random().toString(36).slice(2, 8)}_${finalName}`);
            await fsPromises.writeFile(tempPath, Buffer.from(data));
            return tempPath;
        } catch (error) {
            throw new Error(`保存拖放临时文件失败: ${error.message}`);
        }
    },

    openPath: async (filePath) => {
        // Only for context, might not be needed if host provides generic open
        // But keeping it simple for now if needed by UI
        const { shell } = require('electron');
        shell.openPath(filePath);
    },

    ensureDir: async (dirPath) => {
        await fsPromises.mkdir(dirPath, { recursive: true });
    },

    // === 纯 Node.js PDF 操作 (pdf-lib) ===
    // 所有的不可视化操作（拆分、合并、水印）依然在这里执行，因为 pdf-lib 在 Node 下更高效且无需渲染

    getPDFInfo: async (pdfPath) => {
        try {
            const pdfBytes = await fsPromises.readFile(pdfPath);
            const pdf = await PDFDocument.load(pdfBytes);
            return {
                pageCount: pdf.getPageCount(),
                title: pdf.getTitle() || '',
                author: pdf.getAuthor() || '',
            };
        } catch (error) {
            throw new Error(`获取PDF信息失败: ${error.message}`);
        }
    },

    getFileSize: async (filePath) => {
        try {
            const stats = await fsPromises.stat(filePath);
            return stats.size;
        } catch (error) {
            console.error('Failed to get file size:', error);
            return 0;
        }
    },

    extractPDFImages: async (pdfPath, outputDir) => {
        try {
            const pdfBytes = await fsPromises.readFile(pdfPath);
            const pdfDoc = await PDFDocument.load(pdfBytes);
            const outputPaths = [];
            const visitedRefs = new Set();

            await fsPromises.mkdir(outputDir, { recursive: true });

            const pages = pdfDoc.getPages();
            for (let i = 0; i < pages.length; i++) {
                const page = pages[i];
                const { Resources } = page.node.normalizedEntries();
                if (!Resources) continue;

                const xObjects = Resources.get(PDFName.of('XObject'));
                if (!xObjects) continue;

                if (xObjects instanceof PDFDict) {
                    for (const [key, ref] of xObjects.entries()) {
                        // Global deduplication based on object reference
                        if (visitedRefs.has(ref.toString())) continue;
                        visitedRefs.add(ref.toString());

                        const xObject = pdfDoc.context.lookup(ref);
                        if (xObject instanceof PDFRawStream) {
                            const subtype = xObject.dict.get(PDFName.of('Subtype'));
                            if (subtype === PDFName.of('Image')) {
                                const filter = xObject.dict.get(PDFName.of('Filter'));
                                let ext = '';
                                const data = xObject.contents;

                                // Identify format
                                if (filter === PDFName.of('DCTDecode')) {
                                    ext = 'jpg';
                                } else if (filter === PDFName.of('JPXDecode')) {
                                    ext = 'jp2';
                                } else if (filter === PDFName.of('FlateDecode')) {
                                    // Check magic numbers for PNG: 89 50 4E 47
                                    if (data.length > 4 && data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4E && data[3] === 0x47) {
                                        ext = 'png';
                                    }
                                }

                                if (ext) {
                                    // Use a flatter naming scheme since we are deduplicating globally
                                    // But preserving the "first found page" index is helpful context
                                    const imgName = `image_${outputPaths.length + 1}_p${i + 1}.${ext}`;
                                    const imgPath = path.join(outputDir, imgName);
                                    await fsPromises.writeFile(imgPath, data);
                                    outputPaths.push(imgPath);
                                }
                            }
                        }
                    }
                }
            }
            return outputPaths;
        } catch (error) {
            throw new Error(`提取图片失败: ${error.message}`);
        }
    },

    getPDFImagePreview: async (pdfPath) => {
        try {
            const pdfBytes = await fsPromises.readFile(pdfPath);
            const pdfDoc = await PDFDocument.load(pdfBytes);

            const pages = pdfDoc.getPages();
            // Try first 5 pages to find an image
            const maxPages = Math.min(pages.length, 5);

            for (let i = 0; i < maxPages; i++) {
                const page = pages[i];
                const { Resources } = page.node.normalizedEntries();
                if (!Resources) continue;

                const xObjects = Resources.get(PDFName.of('XObject'));
                if (!xObjects) continue;

                if (xObjects instanceof PDFDict) {
                    for (const [key, ref] of xObjects.entries()) {
                        const xObject = pdfDoc.context.lookup(ref);
                        if (xObject instanceof PDFRawStream) {
                            const subtype = xObject.dict.get(PDFName.of('Subtype'));
                            if (subtype === PDFName.of('Image')) {
                                const filter = xObject.dict.get(PDFName.of('Filter'));
                                let mimeType = '';
                                const data = xObject.contents;

                                if (filter === PDFName.of('DCTDecode')) {
                                    mimeType = 'image/jpeg';
                                } else if (filter === PDFName.of('JPXDecode')) {
                                    mimeType = 'image/jp2';
                                } else if (filter === PDFName.of('FlateDecode')) {
                                    // Check magic numbers for PNG
                                    if (data.length > 4 && data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4E && data[3] === 0x47) {
                                        mimeType = 'image/png';
                                    }
                                }

                                if (mimeType) {
                                    const base64 = Buffer.from(data).toString('base64');
                                    return `data:${mimeType};base64,${base64}`;
                                }
                            }
                        }
                    }
                }
            }
            return null;
        } catch (error) {
            console.error('Preview extraction failed:', error);
            return null;
        }
    },

    splitPDFByPage: async (pdfPath, outputDir, prefix = 'page') => {
        try {
            const pdfBytes = await fsPromises.readFile(pdfPath);
            const pdf = await PDFDocument.load(pdfBytes);
            const pageCount = pdf.getPageCount();
            const outputPaths = [];

            const saveDir = path.join(outputDir, prefix);
            await fsPromises.mkdir(saveDir, { recursive: true });

            for (let i = 0; i < pageCount; i++) {
                const newPdf = await PDFDocument.create();
                const [copiedPage] = await newPdf.copyPages(pdf, [i]);
                newPdf.addPage(copiedPage);

                const newPdfBytes = await newPdf.save();
                const outputPath = path.join(saveDir, `${prefix}_${i + 1}.pdf`);
                await fsPromises.writeFile(outputPath, newPdfBytes);
                outputPaths.push(outputPath);
            }
            return outputPaths;
        } catch (error) {
            throw new Error(`自动拆分PDF失败: ${error.message}`);
        }
    },

    splitPDFByRanges: async (pdfPath, ranges, outputDir) => {
        try {
            const pdfBytes = await fsPromises.readFile(pdfPath);
            const pdf = await PDFDocument.load(pdfBytes);
            const outputPaths = [];

            await fsPromises.mkdir(outputDir, { recursive: true });

            for (const range of ranges) {
                const { start, end, name } = range;
                const newPdf = await PDFDocument.create();
                const pageIndices = [];

                for (let i = start - 1; i < end; i++) {
                    pageIndices.push(i);
                }

                const copiedPages = await newPdf.copyPages(pdf, pageIndices);
                copiedPages.forEach((page) => newPdf.addPage(page));

                const newPdfBytes = await newPdf.save();
                const fileName = name.endsWith('.pdf') ? name : `${name}.pdf`;
                const outputPath = path.join(outputDir, fileName);
                await fsPromises.writeFile(outputPath, newPdfBytes);
                outputPaths.push(outputPath);
            }
            return outputPaths;
        } catch (error) {
            throw new Error(`手动拆分PDF失败: ${error.message}`);
        }
    },

    mergePDFs: async (files, outputDir, fileName = 'merged.pdf') => {
        try {
            const mergedPdf = await PDFDocument.create();

            for (const file of files) {
                const fileBytes = await fsPromises.readFile(file);
                const pdf = await PDFDocument.load(fileBytes);
                const copiedPages = await mergedPdf.copyPages(pdf, pdf.getPageIndices());
                copiedPages.forEach((page) => mergedPdf.addPage(page));
            }

            await fsPromises.mkdir(outputDir, { recursive: true });
            const outputPath = path.join(outputDir, fileName);
            const pdfBytes = await mergedPdf.save();
            await fsPromises.writeFile(outputPath, pdfBytes);
            return outputPath;
        } catch (error) {
            throw new Error(`合并PDF失败: ${error.message}`);
        }
    },

    watermarkPDF: async (pdfPath, watermarkConfig, outputDir) => {
        try {
            const pdfBytes = await fsPromises.readFile(pdfPath);
            const pdf = await PDFDocument.load(pdfBytes);
            const pages = pdf.getPages();

            // Destructure new config structure
            const {
                type = 'text',
                text,
                imagePath,
                layout = 'center', // 'center' | 'tile'
                width: imgWidth, // desired width for image
                height: imgHeight, // desired height for image
                opacity = 0.5,
                rotate = 45,
                color = '#000000',
                fontSize = 50,
                gap = 200 // gap for tile mode
            } = watermarkConfig;

            let embeddedImage;
            let helveticaFont;

            // Prepare resources
            if (type === 'image' && imagePath) {
                const imageBytes = await fsPromises.readFile(imagePath);
                const ext = path.extname(imagePath).toLowerCase();
                if (ext === '.png') {
                    embeddedImage = await pdf.embedPng(imageBytes);
                } else if (ext === '.jpg' || ext === '.jpeg') {
                    embeddedImage = await pdf.embedJpg(imageBytes);
                } else {
                    throw new Error('不支持的图片格式 (仅支持 PNG, JPG)');
                }
            } else {
                helveticaFont = await pdf.embedFont(StandardFonts.Helvetica);
            }

            const drawOnPage = (page) => {
                const { width: pageWidth, height: pageHeight } = page.getSize();
                const rotationAngle = Number(rotate) || 0;
                const pdfRotation = degrees(rotationAngle);
                const rads = (rotationAngle * Math.PI) / 180;

                const textStr = String(text || '');
                const fs = Number(fontSize) || 50;

                // Calculate dimensions
                let wmWidth = 0, wmHeight = 0;

                if (type === 'image' && embeddedImage) {
                    // Check if scale is provided (0-1) or explicit width
                    const scale = Number(watermarkConfig.scale) || 0.5;
                    const dims = embeddedImage.scale(scale);
                    wmWidth = dims.width;
                    wmHeight = dims.height;
                } else if (helveticaFont) {
                    // Calculate exact text size
                    // Handle case where text might be empty or font issues
                    try {
                        wmWidth = helveticaFont.widthOfTextAtSize(textStr, fs);
                        wmHeight = helveticaFont.heightAtSize(fs);
                    } catch (e) {
                        // Fallback estimation
                        wmWidth = textStr.length * fs * 0.5;
                        wmHeight = fs;
                    }
                } else {
                    // Fallback if no font and no image (shouldn't happen for text type)
                    wmWidth = textStr.length * fs * 0.5;
                    wmHeight = fs;
                }

                const drawItem = (cx, cy) => {
                    // Geometric correction for center rotation
                    // We want the center of the rotated item to be at (cx, cy).
                    // pdf-lib rotates around the bottom-left corner of the item (the draw point).
                    // So we need to calculate where to place the draw point (dx, dy) such that:
                    // (dx, dy) + rotated_center_offset = (cx, cy)

                    const w = wmWidth;
                    const h = wmHeight;

                    // Center offset relative to bottom-left (unrotated)
                    // const ox = w / 2;
                    // const oy = h / 2;

                    // Rotated center relative to bottom-left
                    // Using standard Counter-Clockwise rotation matrix (pdf-lib uses CCW)
                    const cos = Math.cos(rads);
                    const sin = Math.sin(rads);

                    const rotatedCenterX = (w / 2) * cos - (h / 2) * sin;
                    const rotatedCenterY = (w / 2) * sin + (h / 2) * cos;

                    const drawX = cx - rotatedCenterX;
                    const drawY = cy - rotatedCenterY;

                    if (type === 'image' && embeddedImage) {
                        page.drawImage(embeddedImage, {
                            x: drawX,
                            y: drawY,
                            width: wmWidth,
                            height: wmHeight,
                            opacity: Number(opacity) || 0.5,
                            rotate: pdfRotation,
                        });
                    } else if (textStr) {
                        const r = parseInt(color.slice(1, 3), 16) / 255;
                        const g = parseInt(color.slice(3, 5), 16) / 255;
                        const b = parseInt(color.slice(5, 7), 16) / 255;

                        if (helveticaFont) {
                            page.drawText(textStr, {
                                x: drawX,
                                y: drawY,
                                size: fs,
                                font: helveticaFont,
                                color: rgb(r, g, b),
                                opacity: Number(opacity) || 0.5,
                                rotate: pdfRotation,
                            });
                        }
                    }
                };

                if (layout === 'tile') {
                    // Refactored Tiling Logic: "Rotated Grid"
                    // To match frontend "container rotation" effect:
                    // 1. Generate grid points relative to center (0,0)
                    // 2. Rotate these points by the rotation angle
                    // 3. Translate to page center

                    // Match frontend gap scaling logic (frontend uses gap/2)
                    const realGap = Number(gap) || 200;

                    const centerX = pageWidth / 2;
                    const centerY = pageHeight / 2;

                    // Calculate coverage radius needed to cover the rotated page corners
                    // Standard radius + buffer
                    const radius = Math.sqrt(pageWidth * pageWidth + pageHeight * pageHeight);
                    const count = Math.ceil(radius / realGap);

                    // Precompute rotation math for grid points
                    // Note: We rotate the *positions* by the same angle as the elements
                    // to simulate the "whole grid rotated" effect.
                    const cos = Math.cos(rads);
                    const sin = Math.sin(rads);

                    for (let r = -count; r <= count; r++) {
                        for (let c = -count; c <= count; c++) {
                            // Original grid point relative to center
                            const gx = c * realGap;
                            const gy = r * realGap;

                            // Rotate the grid point
                            // (x', y') = (x cos - y sin, x sin + y cos)
                            const rx = gx * cos - gy * sin;
                            const ry = gx * sin + gy * cos;

                            // Translate to page center
                            const px = centerX + rx;
                            const py = centerY + ry;

                            // Only draw if within reasonable bounds (optional optimization)
                            // Buffer: add some margin to ensure we cover edges fully
                            const margin = Math.max(wmWidth, wmHeight) * 2 + 100;
                            if (px > -margin && px < pageWidth + margin &&
                                py > -margin && py < pageHeight + margin) {
                                drawItem(px, py);
                            }
                        }
                    }
                } else {
                    // Center
                    drawItem(pageWidth / 2, pageHeight / 2);
                }
            };

            for (const page of pages) {
                drawOnPage(page);
            }

            await fsPromises.mkdir(outputDir, { recursive: true });
            const fileName = path.basename(pdfPath, '.pdf') + '_watermark.pdf';
            const outputPath = path.join(outputDir, fileName);
            const newPdfBytes = await pdf.save();
            await fsPromises.writeFile(outputPath, newPdfBytes);
            return outputPath;
        } catch (error) {
            throw new Error(`添加水印失败: ${error.message}`);
        }
    },

    // Legacy wrappers or empty functions if frontend still calls them directly (though frontend will be updated)
    // pdfToImage, convert* functions are removed as they will be implemented in Frontend
};

logToFile('Preload API loaded (I/O Mode)');
