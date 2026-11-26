import type { Metadata } from "next";
import { PricingView } from "@/components/pricing/pricing-view";

export const metadata: Metadata = {
  title: "Pricing — Clutch Arena | Bảng giá",
  description:
    "Free, 7-Day Cram Pass, Clutch Pro and Team plans for exam prep with grounded AI study decks. Gói miễn phí, Vé Ôn Thi 7 ngày, Clutch Pro và gói nhóm cho sinh viên.",
  alternates: {
    canonical: "/pricing",
  },
  openGraph: {
    type: "website",
    url: "/pricing",
    siteName: "Clutch Arena",
    title: "Clutch Arena Pricing — Cram Pass, Clutch Pro & Team plans",
    description:
      "Pick the plan that fits your exam prep: Free, 7-Day Cram Pass, Clutch Pro (Monthly or Semester), Exam Squad and Tutor & Guild.",
    images: [
      {
        url: "/clutch-arena-full.png",
        width: 1200,
        height: 630,
        alt: "Clutch Arena pricing",
      },
    ],
  },
};

export default function PricingPage() {
  return <PricingView variant="page" />;
}
