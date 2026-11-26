"use client";

import { Dialog } from "@/components/ui/dialog";
import { useLanguage } from "@/lib/i18n/context";
import { PricingView, type PayosCheckoutData } from "./pricing-view";

export type { PayosCheckoutData };

export function PricingModal({
  open,
  onClose,
  initialReason,
}: {
  open: boolean;
  onClose: () => void;
  initialReason?: string | null;
}) {
  const { t } = useLanguage();

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      className="pricing-view-dialog !w-[96vw] !max-w-6xl !max-h-[92vh] !overflow-y-auto !rounded-2xl !border-[#e2e5dc] !bg-[#fafbf9] !p-0 dark:!border-stone-800 dark:!bg-stone-950"
      hideHeader
      hideCloseButton={false}
      title={t.pricingPage.title}
      description={initialReason || t.pricingPage.subtitle}
    >
      <PricingView active={open} initialReason={initialReason} onClose={onClose} variant="modal" />
    </Dialog>
  );
}
