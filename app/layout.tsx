import type { Metadata } from "next";
import { Space_Grotesk, Be_Vietnam_Pro, JetBrains_Mono, Lora } from "next/font/google";
import { LanguageProvider } from "@/lib/i18n/context";
import { AuthProvider } from "@/lib/auth/context";
import { AuthDialog } from "@/components/auth/auth-dialog";
import "katex/dist/katex.min.css";
import "./globals.css";

const spaceGrotesk = Space_Grotesk({
  subsets: ["latin"],
  weight: ["700"],
  variable: "--font-space-grotesk",
  display: "swap",
});

const beVietnamPro = Be_Vietnam_Pro({
  subsets: ["latin", "vietnamese"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-be-vietnam-pro",
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "700"],
  variable: "--font-jetbrains-mono",
  display: "swap",
});

const lora = Lora({
  subsets: ["latin", "vietnamese"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-lora",
  display: "swap",
});

export const metadata: Metadata = {
  title: "ClutchArena — Make every minute count",
  description:
    "Your last-minute study session, upgraded. Turn notes into knowledge with active recall, clutch runs, and study battles.",
  metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL || "https://clutcharena.com"),
  alternates: {
    canonical: "/",
  },
  openGraph: {
    type: "website",
    locale: "vi_VN",
    alternateLocale: ["en_US"],
    url: "/",
    siteName: "Clutch Arena",
    title: "Clutch Arena — Convert 200 Lecture Slides into a 60s Exam Battle & 2-Page Formula Sheet",
    description:
      "Biến 200 slide bài giảng thành đấu trường ôn thi 60 giây và cẩm nang tóm tắt công thức 2 trang. Active recall, multiplayer arena, and AI-verified study decks.",
    images: [
      {
        url: "/clutch-arena-full.png",
        width: 1200,
        height: 630,
        alt: "Clutch Arena — 60s Exam Battle & 2-Page Formula Sheet",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Clutch Arena — Convert 200 Lecture Slides into a 60s Exam Battle & 2-Page Formula Sheet",
    description:
      "Biến 200 slide bài giảng thành đấu trường ôn thi 60 giây và cẩm nang tóm tắt công thức 2 trang. Active recall, multiplayer arena, and AI-verified study decks.",
    images: ["/clutch-arena-full.png"],
  },
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "32x32" },
      { url: "/brand-icon.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [
      { url: "/apple-icon.png", sizes: "180x180", type: "image/png" },
    ],
  },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      className={`${spaceGrotesk.variable} ${beVietnamPro.variable} ${jetbrainsMono.variable} ${lora.variable}`}
    >
      <body>
        <LanguageProvider>
          <AuthProvider>
            {children}
            <AuthDialog />
            {/* Screen-reader and accessibility navigation for legal compliance */}
            <footer className="sr-only" aria-label="Legal & Compliance">
              <nav aria-label="Legal Links">
                <a href="/terms">Terms of Service</a>
                <a href="/privacy">Privacy Policy</a>
              </nav>
            </footer>
          </AuthProvider>
        </LanguageProvider>
      </body>
    </html>
  );
}
