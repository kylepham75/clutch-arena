import { IngestionError } from "./errors";
import { MAX_FILE_BYTES, MAX_DOCX_EXPANDED_BYTES } from "./limits";

export function validateFile(file: File): "pdf" | "docx" | "txt" {
  if (!file.size)
    throw new IngestionError("EMPTY_FILE", "The uploaded file is empty.");
  if (file.size > MAX_FILE_BYTES)
    throw new IngestionError(
      "FILE_TOO_LARGE",
      "Upload a file no larger than 25 MB.",
      413,
    );
  const extension = file.name.split(".").at(-1)?.toLowerCase();
  if (extension !== "pdf" && extension !== "docx" && extension !== "txt")
    throw new IngestionError(
      "UNSUPPORTED_FILE",
      "Upload a PDF, DOCX, or UTF-8 TXT file.",
      415,
    );
  const mime = file.type.toLowerCase().split(";")[0];
  const allowed = {
    pdf: ["application/pdf"],
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

// Read only the ZIP directory. Mammoth never receives an oversized archive.
export function validateDocxArchive(bytes: Buffer) {
  const invalid = () =>
    new IngestionError(
      "INVALID_DOCX",
      "This is not a supported DOCX document. Re-save it as .docx and try again.",
      422,
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
  const directoryEnd = offset + bytes.readUInt32LE(end + 12);
  if (
    entries > 1000 ||
    entries !== bytes.readUInt16LE(end + 8) ||
    directoryEnd !== end
  )
    throw invalid();
  const names = new Set<string>();
  let expanded = 0;
  for (let i = 0; i < entries; i++) {
    if (offset + 46 > end || bytes.readUInt32LE(offset) !== 0x02014b50)
      throw invalid();
    const flags = bytes.readUInt16LE(offset + 8);
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
      throw new IngestionError(
        "DOCUMENT_TOO_LARGE",
        "The expanded DOCX is too large. Split it into smaller documents.",
        413,
      );
    offset = next;
  }
  if (
    offset !== end ||
    !names.has("[Content_Types].xml") ||
    !names.has("word/document.xml")
  )
    throw invalid();
}
