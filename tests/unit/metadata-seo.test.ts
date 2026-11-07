import { describe, it, expect } from "vitest";
import sitemap from "@/app/sitemap";
import robots from "@/app/robots";
import fs from "node:fs";
import path from "node:path";

describe("Metadata and SEO configuration", () => {
  describe("sitemap()", () => {
    it("returns expected public routes with priorities and change frequencies", () => {
      const items = sitemap();
      const urls = items.map((item) => item.url);

      expect(urls.some((url) => url.endsWith("/"))).toBe(true);
      expect(urls.some((url) => url.endsWith("/terms"))).toBe(true);
      expect(urls.some((url) => url.endsWith("/privacy"))).toBe(true);

      const rootItem = items.find((item) => item.url.endsWith("/"));
      expect(rootItem?.priority).toBe(1.0);
      expect(rootItem?.changeFrequency).toBe("daily");

      const termsItem = items.find((item) => item.url.endsWith("/terms"));
      expect(termsItem?.priority).toBe(0.3);
      expect(termsItem?.changeFrequency).toBe("monthly");

      const privacyItem = items.find((item) => item.url.endsWith("/privacy"));
      expect(privacyItem?.priority).toBe(0.3);
      expect(privacyItem?.changeFrequency).toBe("monthly");
    });
  });

  describe("robots()", () => {
    it("returns rules disallowing private routes and linking the sitemap", () => {
      const config = robots();
      const rules = Array.isArray(config.rules) ? config.rules[0] : config.rules;

      expect(rules).toBeDefined();
      expect(rules.disallow).toContain("/api/");
      expect(rules.disallow).toContain("/solo");
      expect(rules.disallow).toContain("/arena");
      expect(rules.allow).toContain("/");
      expect(rules.allow).toContain("/terms");
      expect(rules.allow).toContain("/privacy");

      expect(config.sitemap).toMatch(/\/sitemap\.xml$/);
    });
  });

  describe("metadata layout", () => {
    it("defines openGraph and twitter objects with image /clutch-arena-full.png", () => {
      const layoutSource = fs.readFileSync(path.resolve(process.cwd(), "app/layout.tsx"), "utf-8");

      expect(layoutSource).toContain("export const metadata: Metadata = {");
      expect(layoutSource).toContain("openGraph: {");
      expect(layoutSource).toContain("twitter: {");
      expect(layoutSource).toContain('card: "summary_large_image"');
      expect(layoutSource).toContain('url: "/clutch-arena-full.png"');
      expect(layoutSource).toContain('images: ["/clutch-arena-full.png"]');
      expect(layoutSource).toContain("Clutch Arena — Convert 200 Lecture Slides into a 60s Exam Battle & 2-Page Formula Sheet");
      expect(layoutSource).toContain("Biến 200 slide bài giảng thành đấu trường ôn thi 60 giây và cẩm nang tóm tắt công thức 2 trang");
    });
  });
});
