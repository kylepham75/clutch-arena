"use client";

import { Suspense, use } from "react";
import Link from "next/link";
import { ArenaManager } from "@/components/arena/arena-manager";
import { useLanguage } from "@/lib/i18n/context";
import { LanguageSwitcher } from "@/components/ui/language-switcher";

function ArenaContent({
  searchParams,
}: {
  searchParams?: Promise<{ room?: string }>;
}) {
  const resolved = searchParams ? use(searchParams) : undefined;
  return <ArenaManager initialRoomCode={resolved?.room} />;
}

export default function ArenaPage(props: {
  searchParams?: Promise<{ room?: string }>;
}) {
  const { t } = useLanguage();

  return (
    <div className="arena-page-shell">
      <header className="arena-page-header">
        <Link href="/" className="brand">
          <span className="brand-icon brand-icon-logo">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/brand-icon.png" alt={t.arena.brandAlt} className="brand-logo-img" />
          </span>
          <span>
            clutch<span className="brand-light">arena</span>
            <small>{t.arena.headerSubtitle}</small>
          </span>
        </Link>

        <div className="arena-header-links flex items-center gap-3">
          <LanguageSwitcher />
          <Link href="/solo" className="back-to-solo-link">
            {t.arena.backToSoloLink}
          </Link>
        </div>
      </header>

      <main className="arena-page-main">
        <Suspense fallback={<div className="arena-loading-screen">{t.arena.loadingArena}</div>}>
          <ArenaContent searchParams={props.searchParams} />
        </Suspense>
      </main>
    </div>
  );
}
