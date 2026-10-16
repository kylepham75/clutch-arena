export function formatRejectionError(
  error?: { code?: string; message?: string } | null,
  fallback?: string,
): string {
  if (!error) return fallback || "";
  const msg = error.message || "";
  if (error.code === "file-too-large" || /larger than \d+ bytes/i.test(msg)) {
    return msg.replace(/(\d+)\s*bytes/gi, (_, bytesStr) => {
      const bytes = Number(bytesStr);
      if (isNaN(bytes)) return `${bytesStr} bytes`;
      const mb = Math.round(bytes / (1024 * 1024));
      return `${mb} MB`;
    });
  }
  if (msg.includes("bytes")) {
    return msg.replace(/(\d+)\s*bytes/gi, (_, bytesStr) => {
      const bytes = Number(bytesStr);
      if (isNaN(bytes)) return `${bytesStr} bytes`;
      const mb = Math.round(bytes / (1024 * 1024));
      return mb >= 1 ? `${mb} MB` : `${Math.round(bytes / 1024)} KB`;
    });
  }
  return msg || fallback || "";
}
