/**
 * Client-side file optimization and compression utilities to prevent
 * Vercel Serverless Function 4.5 MB request body limit violations (HTTP 413).
 */

export const VERCEL_PAYLOAD_LIMIT_BYTES = 4.2 * 1024 * 1024; // 4.2 MB safe buffer for 4.5 MB Vercel limit

/**
 * Downscales an image blob using HTML5 Canvas or OffscreenCanvas.
 * Preserves format (PNG/JPEG/WebP) and caps max resolution at 1280px.
 */
async function downscaleImageBlob(
  blob: Blob,
  mimeType: string,
  maxWidth = 1280,
  maxHeight = 1280,
  quality = 0.75,
): Promise<Uint8Array | null> {
  if (typeof window === "undefined") {
    return null;
  }

  let imageSource: ImageBitmap | HTMLImageElement;
  let width = 0;
  let height = 0;

  if (typeof createImageBitmap === "function") {
    try {
      imageSource = await createImageBitmap(blob);
      width = imageSource.width;
      height = imageSource.height;
    } catch {
      return null;
    }
  } else if (typeof Image !== "undefined") {
    try {
      const url = URL.createObjectURL(blob);
      const img = new Image();
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject();
        img.src = url;
      });
      URL.revokeObjectURL(url);
      imageSource = img;
      width = img.naturalWidth || img.width;
      height = img.naturalHeight || img.height;
    } catch {
      return null;
    }
  } else {
    return null;
  }

  // If image dimensions are already small and byte size isn't excessive, skip
  if (width <= maxWidth && height <= maxHeight && blob.size <= 150 * 1024) {
    if ("close" in imageSource && typeof (imageSource as any).close === "function") {
      (imageSource as any).close();
    }
    return null;
  }

  // Compute aspect ratio
  let newWidth = width;
  let newHeight = height;
  if (newWidth > maxWidth) {
    newHeight = Math.round((newHeight * maxWidth) / newWidth);
    newWidth = maxWidth;
  }
  if (newHeight > maxHeight) {
    newWidth = Math.round((newWidth * maxHeight) / newHeight);
    newHeight = maxHeight;
  }

  let outBlob: Blob | null = null;
  const isJpeg = mimeType === "image/jpeg" || mimeType === "image/jpg";
  const targetMime = isJpeg ? "image/jpeg" : mimeType === "image/webp" ? "image/webp" : "image/png";

  try {
    if (typeof OffscreenCanvas !== "undefined") {
      const canvas = new OffscreenCanvas(newWidth, newHeight);
      const ctx = canvas.getContext("2d");
      if (ctx) {
        if (isJpeg) {
          ctx.fillStyle = "#FFFFFF";
          ctx.fillRect(0, 0, newWidth, newHeight);
        }
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = "high";
        ctx.drawImage(imageSource, 0, 0, newWidth, newHeight);
        outBlob = await canvas.convertToBlob({
          type: targetMime,
          quality: isJpeg ? quality : undefined,
        });
      }
    } else if (typeof document !== "undefined") {
      const canvas = document.createElement("canvas");
      canvas.width = newWidth;
      canvas.height = newHeight;
      const ctx = canvas.getContext("2d");
      if (ctx) {
        if (isJpeg) {
          ctx.fillStyle = "#FFFFFF";
          ctx.fillRect(0, 0, newWidth, newHeight);
        }
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = "high";
        ctx.drawImage(imageSource, 0, 0, newWidth, newHeight);
        outBlob = await new Promise<Blob | null>((resolve) =>
          canvas.toBlob(resolve, targetMime, isJpeg ? quality : undefined),
        );
      }
    }
  } catch {
    outBlob = null;
  } finally {
    if ("close" in imageSource && typeof (imageSource as any).close === "function") {
      (imageSource as any).close();
    }
  }

  if (!outBlob || outBlob.size >= blob.size) {
    return null;
  }

  const arrayBuf = await outBlob.arrayBuffer();
  return new Uint8Array(arrayBuf);
}

/**
 * Compresses large presentation images inside a PPTX file using JSZip and Canvas downsampling.
 * Typically shrinks 15-30 MB PowerPoint files down to 1-2 MB while preserving all XML slide text.
 */
export async function compressPptxFile(
  file: File,
  signal?: AbortSignal,
  onProgress?: (msg: string) => void,
): Promise<File> {
  signal?.throwIfAborted();
  if (file.size <= VERCEL_PAYLOAD_LIMIT_BYTES) {
    return file;
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  signal?.throwIfAborted();

  // Validate ZIP magic bytes (PK\x03\x04)
  if (
    bytes.length < 4 ||
    bytes[0] !== 0x50 ||
    bytes[1] !== 0x4b ||
    bytes[2] !== 0x03 ||
    bytes[3] !== 0x04
  ) {
    return file;
  }

  const JSZip = (await import("jszip")).default;
  let zip: InstanceType<typeof JSZip>;
  try {
    zip = await JSZip.loadAsync(bytes);
  } catch {
    return file;
  }

  // Find all images in ppt/media/
  const mediaEntries: Array<{ path: string; ext: string; mime: string }> = [];
  const mediaRegex = /^ppt\/media\/([^\/]+)\.(png|jpe?g|webp|bmp)$/i;

  zip.forEach((relPath) => {
    const match = relPath.match(mediaRegex);
    if (match) {
      const ext = match[2].toLowerCase();
      const mime =
        ext === "png"
          ? "image/png"
          : ext === "webp"
            ? "image/webp"
            : ext === "bmp"
              ? "image/bmp"
              : "image/jpeg";
      mediaEntries.push({ path: relPath, ext, mime });
    }
  });

  if (mediaEntries.length === 0) {
    return file;
  }

  let modifiedCount = 0;
  for (let i = 0; i < mediaEntries.length; i++) {
    signal?.throwIfAborted();
    const entry = mediaEntries[i];
    const zipFile = zip.file(entry.path);
    if (!zipFile) continue;

    const imgBytes = await zipFile.async("uint8array");
    // Only downscale images larger than 75 KB
    if (imgBytes.byteLength < 75 * 1024) continue;

    onProgress?.(`Compressing slide image ${i + 1}/${mediaEntries.length}...`);

    const imgBlob = new Blob([imgBytes as BlobPart], { type: entry.mime });
    const downscaled = await downscaleImageBlob(imgBlob, entry.mime, 1280, 1280, 0.75);

    if (downscaled && downscaled.byteLength < imgBytes.byteLength) {
      zip.file(entry.path, downscaled);
      modifiedCount++;
    }
  }

  if (modifiedCount === 0) {
    return file;
  }

  onProgress?.("Rebuilding compressed presentation...");
  const compressedBlob = await zip.generateAsync({
    type: "blob",
    compression: "DEFLATE",
    compressionOptions: { level: 6 },
  });

  if (compressedBlob.size < file.size) {
    return new File([compressedBlob], file.name, {
      type: file.type || "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      lastModified: Date.now(),
    });
  }

  return file;
}

/**
 * Extracts slide text in browser (via pdfjs-dist) and converts to clean structured text.
 * Drops payload size by 98-99% (e.g. 15 MB PDF -> 60 KB text file) without serverless timeouts.
 */
export async function compressPdfOrExtract(
  file: File,
  signal?: AbortSignal,
  onProgress?: (msg: string) => void,
): Promise<File> {
  signal?.throwIfAborted();
  onProgress?.("Extracting slide text in browser to fit upload limit...");

  const { extractSlidesInBrowser } = await import("@/lib/notes/client-extract-slides");
  const extracted = await extractSlidesInBrowser(file, signal);

  if (!extracted || !extracted.sources || extracted.sources.length === 0) {
    throw new Error("Could not extract readable text from document.");
  }

  // Format extracted sources as human-readable slide sections
  const lines: string[] = [];
  for (const src of extracted.sources) {
    const slideMatch = src.id.match(/^slide-(\d+)$/i);
    const slideNum = slideMatch ? slideMatch[1] : (src.label.match(/\d+/) || ["1"])[0];
    lines.push(`=== Slide ${slideNum} ===`);
    lines.push(src.text.trim());
    lines.push("");
  }

  const formattedText = lines.join("\n").trim();
  const textBlob = new Blob([formattedText], { type: "text/plain;charset=utf-8" });

  const newFileName = file.name.replace(/\.(pdf|pptx|docx)$/i, "") + ".txt";
  return new File([textBlob], newFileName, {
    type: "text/plain",
    lastModified: Date.now(),
  });
}

/**
 * Automatically inspects file size before uploading to /api/ingest.
 * If file exceeds 4.2 MB, applies auto-compression (PPTX image downsampling or PDF text extraction).
 */
export async function optimizeUploadFileIfNeeded(
  file: File,
  signal?: AbortSignal,
  onStatus?: (msg: string) => void,
): Promise<{ file: File; wasCompressed: boolean; reason?: string }> {
  if (file.size <= VERCEL_PAYLOAD_LIMIT_BYTES) {
    return { file, wasCompressed: false };
  }

  const ext = file.name.split(".").at(-1)?.toLowerCase();

  if (ext === "pptx") {
    onStatus?.("Compressing large presentation images...");
    try {
      const compressedPptx = await compressPptxFile(file, signal, onStatus);
      if (compressedPptx.size <= VERCEL_PAYLOAD_LIMIT_BYTES) {
        const origMb = (file.size / (1024 * 1024)).toFixed(1);
        const compMb = (compressedPptx.size / (1024 * 1024)).toFixed(1);
        return {
          file: compressedPptx,
          wasCompressed: true,
          reason: `Auto-compressed images (${origMb}MB → ${compMb}MB)`,
        };
      }
    } catch (err) {
      console.warn("PPTX image compression failed, falling back to slide text extraction:", err);
    }

    // If PPTX is still > 4.2 MB after image downscaling, extract text
    onStatus?.("Presentation still exceeds 4.5MB limit. Extracting slide text...");
    const extractedTxt = await compressPdfOrExtract(file, signal, onStatus);
    const origMb = (file.size / (1024 * 1024)).toFixed(1);
    const txtKb = Math.round(extractedTxt.size / 1024);
    return {
      file: extractedTxt,
      wasCompressed: true,
      reason: `Extracted slide text (${origMb}MB PPTX → ${txtKb}KB text)`,
    };
  }

  if (ext === "pdf") {
    onStatus?.("PDF exceeds 4.5MB limit. Extracting slide text in browser...");
    const extractedTxt = await compressPdfOrExtract(file, signal, onStatus);
    const origMb = (file.size / (1024 * 1024)).toFixed(1);
    const txtKb = Math.round(extractedTxt.size / 1024);
    return {
      file: extractedTxt,
      wasCompressed: true,
      reason: `Extracted slide text (${origMb}MB PDF → ${txtKb}KB text)`,
    };
  }

  return { file, wasCompressed: false };
}
