"use client";

import { useLanguage } from "@/lib/i18n/context";

export default function ErrorPage({ reset }: { reset: () => void }) {
  const { t } = useLanguage();

  return (
    <main className="error-page">
      <h1>{t.common.errorTitle}</h1>
      <p>{t.common.errorFallback}</p>
      <button className="btn btn-primary" onClick={reset}>
        {t.common.tryAgainBtn}
      </button>
    </main>
  );
}
