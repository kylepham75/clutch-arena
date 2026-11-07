import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  const baseUrl = (process.env.NEXT_PUBLIC_APP_URL || "https://clutcharena.com").replace(/\/$/, "");

  return {
    rules: {
      userAgent: "*",
      allow: ["/", "/terms", "/privacy"],
      disallow: ["/api/", "/solo", "/arena"],
    },
    sitemap: `${baseUrl}/sitemap.xml`,
  };
}
