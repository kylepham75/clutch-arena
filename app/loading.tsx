"use client";

import { useLanguage } from "@/lib/i18n/context";

export default function Loading() {
  const { t } = useLanguage();

  return (
    <main className="error-page" role="status">
      <span className="loading-bolt">ϟ</span>
      <p>{t.common.loadingText}</p>
    </main>
  );
}
