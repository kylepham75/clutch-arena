import { inflateRawSync } from "node:zlib";
import { IngestionError } from "./errors";
import { MAX_FILE_BYTES, MAX_DOCX_EXPANDED_BYTES } from "./limits";

export function validateFile(file: File): "pdf" | "docx" | "txt" | "pptx" {
  if (!file.size)
    throw new IngestionError("EMPTY_FILE", "The uploaded file is empty.");
  if (file.size > MAX_FILE_BYTES)
    throw new IngestionError(
      "FILE_TOO_LARGE",
      "Upload a file no larger than 25 MB.",
      413,
    );
  const extension = file.name.split(".").at(-1)?.toLowerCase();
  if (
    extension !== "pdf" &&
    extension !== "docx" &&
    extension !== "txt" &&
    extension !== "pptx"
  )
    throw new IngestionError(
      "UNSUPPORTED_FILE",
      "Upload a PDF, PowerPoint (.pptx), DOCX, or UTF-8 TXT file.",
      415,
    );
  const mime = file.type.toLowerCase().split(";")[0];
  const allowed = {
    pdf: ["application/pdf"],
    pptx: [
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      "application/zip",
      "application/octet-stream",
    ],
    docx: [
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "application/zip",
    ],
    txt: ["text/plain"],
  };
  if (
    mime &&
    mime !== "application/octet-stream" &&
    !allowed[extension].includes(mime)
  )
    throw new IngestionError(
      "FILE_TYPE_MISMATCH",
      "The file type does not match its extension.",
      415,
    );
  return extension;
}

interface ZipEntryMeta {
  name: string;
  compressionMethod: number;
  compressedSize: number;
  declaredSize: number;
  localHeaderOffset: number;
  hasDataDescriptor: boolean;
}

function verifyZipDecompressionBounds(
  bytes: Buffer,
  entriesMeta: ZipEntryMeta[],
  centralDirStart: number,
  maxTotalBytes: number,
  maxXmlEntryBytes: number,
  invalid: () => IngestionError,
  tooLarge: () => IngestionError,
): void {
  const sorted = [...entriesMeta].sort(
    (a, b) => a.localHeaderOffset - b.localHeaderOffset,
  );

  let totalActualExpanded = 0;
  let lastEnd = 0;

  for (let idx = 0; idx < sorted.length; idx++) {
    const entry = sorted[idx];
    if (entry.localHeaderOffset < lastEnd) {
      throw invalid();
    }
    if (entry.localHeaderOffset + 30 > centralDirStart) {
      throw invalid();
    }
    const localNameLen = bytes.readUInt16LE(entry.localHeaderOffset + 26);
    const localExtraLen = bytes.readUInt16LE(entry.localHeaderOffset + 28);
    const dataStart = entry.localHeaderOffset + 30 + localNameLen + localExtraLen;
    if (dataStart > centralDirStart) {
      throw invalid();
    }

    const nextBoundary =
      idx + 1 < sorted.length ? sorted[idx + 1].localHeaderOffset : centralDirStart;
    if (nextBoundary < dataStart || nextBoundary > bytes.length) {
      throw invalid();
    }

    let dataEnd: number;
    if (entry.compressedSize > 0 && entry.compressedSize !== 0xffffffff) {
      dataEnd = dataStart + entry.compressedSize;
      if (dataEnd > nextBoundary) {
        throw invalid();
      }
    } else if (entry.hasDataDescriptor) {
      dataEnd = nextBoundary;
    } else {
      dataEnd = dataStart;
    }

    const compressedSlice = bytes.subarray(dataStart, dataEnd);
    const isXml = entry.name.endsWith(".xml") || entry.name.endsWith(".rels");
    const remainingBudget = maxTotalBytes - totalActualExpanded;
    if (remainingBudget < 0) {
      throw tooLarge();
    }
    const entryCap = isXml
      ? Math.min(maxXmlEntryBytes, remainingBudget)
      : remainingBudget;

    let actualSize = 0;
    if (entry.compressionMethod === 0) {
      actualSize = compressedSlice.byteLength;
      if (actualSize > entryCap) {
        throw tooLarge();
      }
    } else if (entry.compressionMethod === 8) {
      if (compressedSlice.byteLength > 0) {
        try {
          const inflated = inflateRawSync(compressedSlice, {
            maxOutputLength: Math.max(0, entryCap),
          });
          actualSize = inflated.byteLength;
        } catch (err) {
          const code = (err as { code?: string } | null)?.code;
          if (code === "ERR_BUFFER_TOO_LARGE" || err instanceof RangeError) {
            throw tooLarge();
          }
          throw invalid();
        }
      }
    } else {
      throw invalid();
    }

    totalActualExpanded += actualSize;
    if (totalActualExpanded > maxTotalBytes) {
      throw tooLarge();
    }
    lastEnd = dataEnd;
  }
}

// Read only the ZIP directory and verify actual DEFLATE stream expansion bounds. Mammoth never receives an oversized archive.
export function validateDocxArchive(bytes: Buffer) {
  const invalid = () =>
    new IngestionError(
      "INVALID_DOCX",
      "This is not a supported DOCX document. Re-save it as .docx and try again.",
      422,
    );
  const tooLarge = () =>
    new IngestionError(
      "DOCUMENT_TOO_LARGE",
      "The expanded DOCX is too large. Split it into smaller documents.",
      413,
    );
  if (bytes.length < 22 || bytes.readUInt32LE(0) !== 0x04034b50)
    throw invalid();
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
    if (
      bytes.readUInt32LE(i) === 0x06054b50 &&
      i + 22 + bytes.readUInt16LE(i + 20) === bytes.length
    ) {
      end = i;
      break;
    }
  }
  if (
    end < 0 ||
    bytes.readUInt16LE(end + 4) !== 0 ||
    bytes.readUInt16LE(end + 6) !== 0
  )
    throw invalid();
  const entries = bytes.readUInt16LE(end + 10);
  let offset = bytes.readUInt32LE(end + 16);
  const centralDirStart = offset;
  const directoryEnd = offset + bytes.readUInt32LE(end + 12);
  if (
    entries > 1000 ||
    entries !== bytes.readUInt16LE(end + 8) ||
    directoryEnd !== end
  )
    throw invalid();
  const names = new Set<string>();
  const entriesMeta: ZipEntryMeta[] = [];
  let expanded = 0;
  for (let i = 0; i < entries; i++) {
    if (offset + 46 > end || bytes.readUInt32LE(offset) !== 0x02014b50)
      throw invalid();
    const flags = bytes.readUInt16LE(offset + 8);
    const compressionMethod = bytes.readUInt16LE(offset + 10);
    const compressedSize = bytes.readUInt32LE(offset + 20);
    const size = bytes.readUInt32LE(offset + 24);
    const nameLength = bytes.readUInt16LE(offset + 28);
    const next =
      offset +
      46 +
      nameLength +
      bytes.readUInt16LE(offset + 30) +
      bytes.readUInt16LE(offset + 32);
    if (next > end || flags & 1 || size === 0xffffffff) throw invalid();
    const name = bytes.toString("utf8", offset + 46, offset + 46 + nameLength);
    if (
      names.has(name) ||
      name.includes("..") ||
      name.startsWith("/") ||
      name.includes("\\")
    )
      throw invalid();
    names.add(name);
    expanded += size;
    if (expanded > MAX_DOCX_EXPANDED_BYTES)
      throw tooLarge();
    const localHeaderOffset = bytes.readUInt32LE(offset + 42);
    if (
      localHeaderOffset + 30 > bytes.length ||
      bytes.readUInt32LE(localHeaderOffset) !== 0x04034b50
    ) {
      throw invalid();
    }
    const localFlags = bytes.readUInt16LE(localHeaderOffset + 6);
    const localSize = bytes.readUInt32LE(localHeaderOffset + 22);
    const hasDataDescriptor = Boolean((flags & 8) || (localFlags & 8));
    if (!hasDataDescriptor && localSize !== 0) {
      if (localSize > MAX_DOCX_EXPANDED_BYTES || localSize > size) {
        throw tooLarge();
      }
      if (localSize !== size) {
        throw invalid();
      }
    }
    entriesMeta.push({
      name,
      compressionMethod,
      compressedSize,
      declaredSize: size,
      localHeaderOffset,
      hasDataDescriptor,
    });
    offset = next;
  }
  if (
    offset !== end ||
    !names.has("[Content_Types].xml") ||
    !names.has("word/document.xml")
  )
    throw invalid();

  verifyZipDecompressionBounds(
    bytes,
    entriesMeta,
    centralDirStart,
    MAX_DOCX_EXPANDED_BYTES,
    MAX_DOCX_EXPANDED_BYTES,
    invalid,
    tooLarge,
  );
}

export function validatePptxArchive(bytes: Buffer): void {
  const invalid = () =>
    new IngestionError(
      "INVALID_PPTX",
      "This file does not contain a valid PowerPoint presentation.",
      422,
    );
  const tooLarge = () =>
    new IngestionError(
      "DOCUMENT_TOO_LARGE",
      "The expanded PowerPoint archive is too large. Split the presentation into smaller decks.",
      413,
    );
  if (bytes.length < 22 || bytes.readUInt32LE(0) !== 0x04034b50)
    throw invalid();
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
    if (
      bytes.readUInt32LE(i) === 0x06054b50 &&
      i + 22 + bytes.readUInt16LE(i + 20) === bytes.length
    ) {
      end = i;
      break;
    }
  }
  if (
    end < 0 ||
    bytes.readUInt16LE(end + 4) !== 0 ||
    bytes.readUInt16LE(end + 6) !== 0
  )
    throw invalid();
  const entries = bytes.readUInt16LE(end + 10);
  let offset = bytes.readUInt32LE(end + 16);
  const centralDirStart = offset;
  const directoryEnd = offset + bytes.readUInt32LE(end + 12);
  if (
    entries > 2000 ||
    entries !== bytes.readUInt16LE(end + 8) ||
    directoryEnd !== end
  )
    throw invalid();
  const names = new Set<string>();
  const entriesMeta: ZipEntryMeta[] = [];
  let expanded = 0;
  const maxExpandedBytes = MAX_DOCX_EXPANDED_BYTES * 2.5;
  for (let i = 0; i < entries; i++) {
    if (offset + 46 > end || bytes.readUInt32LE(offset) !== 0x02014b50)
      throw invalid();
    const flags = bytes.readUInt16LE(offset + 8);
    const compressionMethod = bytes.readUInt16LE(offset + 10);
    const compressedSize = bytes.readUInt32LE(offset + 20);
    const size = bytes.readUInt32LE(offset + 24);
    const nameLength = bytes.readUInt16LE(offset + 28);
    const next =
      offset +
      46 +
      nameLength +
      bytes.readUInt16LE(offset + 30) +
      bytes.readUInt16LE(offset + 32);
    if (next > end || flags & 1 || size === 0xffffffff) throw invalid();
    const name = bytes.toString("utf8", offset + 46, offset + 46 + nameLength);
    if (
      names.has(name) ||
      name.includes("..") ||
      name.startsWith("/") ||
      name.includes("\\")
    )
      throw invalid();
    names.add(name);
    expanded += size;
    if (
      expanded > maxExpandedBytes ||
      ((name.endsWith(".xml") || name.endsWith(".rels")) &&
        size > MAX_DOCX_EXPANDED_BYTES)
    )
      throw tooLarge();
    const localHeaderOffset = bytes.readUInt32LE(offset + 42);
    if (
      localHeaderOffset + 30 > bytes.length ||
      bytes.readUInt32LE(localHeaderOffset) !== 0x04034b50
    ) {
      throw invalid();
    }
    const localFlags = bytes.readUInt16LE(localHeaderOffset + 6);
    const localSize = bytes.readUInt32LE(localHeaderOffset + 22);
    const hasDataDescriptor = Boolean((flags & 8) || (localFlags & 8));
    if (!hasDataDescriptor && localSize !== 0) {
      if (
        localSize > maxExpandedBytes ||
        ((name.endsWith(".xml") || name.endsWith(".rels")) &&
          localSize > MAX_DOCX_EXPANDED_BYTES) ||
        localSize > size
      ) {
        throw tooLarge();
      }
      if (localSize !== size) {
        throw invalid();
      }
    }
    entriesMeta.push({
      name,
      compressionMethod,
      compressedSize,
      declaredSize: size,
      localHeaderOffset,
      hasDataDescriptor,
    });
    offset = next;
  }
  if (offset !== end) throw invalid();

  verifyZipDecompressionBounds(
    bytes,
    entriesMeta,
    centralDirStart,
    maxExpandedBytes,
    MAX_DOCX_EXPANDED_BYTES,
    invalid,
    tooLarge,
  );
}

