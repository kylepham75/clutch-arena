import { describe, it, expect } from "vitest";
import { formatRejectionError } from "@/lib/utils/format-upload-error";

describe("formatRejectionError", () => {
  it("rounds raw byte sizes to MB for file-too-large errors", () => {
    const error5MB = {
      code: "file-too-large",
      message: "File is larger than 5242880 bytes",
    };
    expect(formatRejectionError(error5MB)).toBe("File is larger than 5 MB");

    const error25MB = {
      code: "file-too-large",
      message: "File is larger than 26214400 bytes",
    };
    expect(formatRejectionError(error25MB)).toBe("File is larger than 25 MB");
  });

  it("handles general messages with bytes", () => {
    const error = {
      code: "file-too-large",
      message: "File is larger than 10485760 bytes",
    };
    expect(formatRejectionError(error)).toBe("File is larger than 10 MB");
  });

  it("preserves non-byte errors untouched", () => {
    const error = {
      code: "file-invalid-type",
      message: "File type must be PDF, DOCX or TXT",
    };
    expect(formatRejectionError(error)).toBe("File type must be PDF, DOCX or TXT");
  });

  it("falls back when error is null or undefined", () => {
    expect(formatRejectionError(null, "Default error")).toBe("Default error");
    expect(formatRejectionError(undefined, "Default error")).toBe("Default error");
  });
});
