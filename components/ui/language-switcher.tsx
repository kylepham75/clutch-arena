"use client";

import { useLanguage } from "@/lib/i18n/context";
import { Globe } from "lucide-react";

export function LanguageSwitcher({ className = "" }: { className?: string }) {
  const { language, setLanguage } = useLanguage();

  return (
    <div
      className={`lang-switcher ${className}`}
      role="radiogroup"
      aria-label="Select website language"
    >
      <button
        type="button"
        role="radio"
        aria-checked={language === "en"}
        className={`lang-switcher-btn ${language === "en" ? "active" : ""}`}
        onClick={() => setLanguage("en")}
        title="Switch to English"
      >
        <span>EN</span>
      </button>
      <button
        type="button"
        role="radio"
        aria-checked={language === "vi"}
        className={`lang-switcher-btn ${language === "vi" ? "active" : ""}`}
        onClick={() => setLanguage("vi")}
        title="Chuyển sang Tiếng Việt"
      >
        <span>VI</span>
      </button>
    </div>
  );
}
