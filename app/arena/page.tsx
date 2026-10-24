import { Suspense } from "react";
import Link from "next/link";
import { Zap } from "lucide-react";
import { ArenaManager } from "@/components/arena/arena-manager";

export default async function ArenaPage(props: {
  searchParams: Promise<{ room?: string }>;
}) {
  const { room } = await props.searchParams;

  return (
    <div className="arena-page-shell">
      <header className="arena-page-header">
        <Link href="/" className="brand">
          <span className="brand-icon brand-icon-logo">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/brand-icon.png" alt="Clutch Arena" className="brand-logo-img" />
          </span>
          <span>
            clutch<span className="brand-light">arena</span>
            <small>MULTIPLAYER STUDY ARENA</small>
          </span>
        </Link>

        <div className="arena-header-links">
          <Link href="/solo" className="back-to-solo-link">
            ← Back to Solo Practice
          </Link>
        </div>
      </header>

      <main className="arena-page-main">
        <Suspense fallback={<div className="arena-loading-screen">Loading Arena…</div>}>
          <ArenaManager initialRoomCode={room} />
        </Suspense>
      </main>
    </div>
  );
}
