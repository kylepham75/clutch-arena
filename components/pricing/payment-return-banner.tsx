"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Copy,
  Loader2,
  X,
  XCircle,
} from "lucide-react";
import { useLanguage } from "@/lib/i18n/context";
import { useAuth } from "@/lib/auth/context";
import { useUserTier } from "@/hooks/use-user-tier";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

export type PaymentReturnStatus = "success" | "cancelled";

export interface PaymentReturnParams {
  status: PaymentReturnStatus;
  provider: string | null;
  checkoutId: string | null;
  orderCode: number | null;
}

interface SquadCodeDisplayItem {
  code: string;
  status: "available" | "redeemed";
}

type BannerPhase = "idle" | "verifying" | "success" | "cancelled" | "error";

const RETURN_QUERY_KEYS = ["payment", "provider", "checkoutId", "orderCode"] as const;

const FONT_HEADING = "font-[family-name:var(--font-heading)]";
const FONT_BODY = "font-[family-name:var(--font-body)]";
const FONT_MONO = "font-[family-name:var(--font-mono)]";

/**
 * Parses checkout redirect parameters from `window.location.search`.
 * Returns `null` unless `payment` is `"success"` or `"cancelled"`.
 */
export function parsePaymentReturnParams(search: string): PaymentReturnParams | null {
  const params = new URLSearchParams(search);
  const payment = params.get("payment");
  if (payment !== "success" && payment !== "cancelled") {
    return null;
  }

  const rawProvider = params.get("provider");
  const provider = rawProvider && rawProvider.trim() ? rawProvider.trim() : null;

  const rawCheckoutId = params.get("checkoutId");
  const checkoutId = rawCheckoutId && rawCheckoutId.trim() ? rawCheckoutId.trim() : null;

  const rawOrderCode = params.get("orderCode");
  const parsedOrderCode =
    rawOrderCode && rawOrderCode.trim() ? Number(rawOrderCode.trim()) : NaN;
  const orderCode =
    Number.isInteger(parsedOrderCode) && parsedOrderCode > 0 ? parsedOrderCode : null;

  return {
    status: payment,
    provider,
    checkoutId,
    orderCode,
  };
}

/**
 * Strips transient payment-return query parameters while preserving
 * unrelated query params (e.g. `?pack=...`) and the URL hash (e.g. `#pack=...`).
 */
export function buildCleanReturnUrl(
  pathname: string,
  search: string,
  hash: string,
): string {
  const params = new URLSearchParams(search);
  for (const key of RETURN_QUERY_KEYS) {
    params.delete(key);
  }
  const remaining = params.toString();
  const queryPart = remaining ? `?${remaining}` : "";
  const hashPart = hash ? (hash.startsWith("#") ? hash : `#${hash}`) : "";
  return `${pathname}${queryPart}${hashPart}`;
}

export function PaymentReturnBanner() {
  const { t } = useLanguage();
  const tp = t.paymentReturn;
  const tPricing = t.pricingPage;
  const { session, loading: authLoading } = useAuth();
  const { refreshTier, refreshQuota } = useUserTier();

  const [returnParams, setReturnParams] = useState<PaymentReturnParams | null>(null);
  const [phase, setPhase] = useState<BannerPhase>("idle");
  const [dismissed, setDismissed] = useState(false);
  const [squadCodes, setSquadCodes] = useState<SquadCodeDisplayItem[]>([]);
  const [copiedCode, setCopiedCode] = useState<string | null>(null);

  const processedRef = useRef<PaymentReturnParams | null>(null);
  const completedRef = useRef(false);
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (copyTimerRef.current) {
        clearTimeout(copyTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const parsed = processedRef.current ?? parsePaymentReturnParams(window.location.search);
    if (!parsed) return;

    if (!processedRef.current) {
      processedRef.current = parsed;
      const cleanUrl = buildCleanReturnUrl(
        window.location.pathname,
        window.location.search,
        window.location.hash,
      );
      window.history.replaceState(window.history.state, "", cleanUrl);
    }

    setReturnParams(parsed);
    setPhase((prev) => {
      if (prev === "success" || prev === "error" || prev === "cancelled") {
        return prev;
      }
      return parsed.status === "cancelled" ? "cancelled" : "verifying";
    });
  }, []);

  useEffect(() => {
    if (!returnParams || returnParams.status !== "success") return;
    if (authLoading || completedRef.current) return;

    let cancelled = false;

    const verifyAndSync = async () => {
      try {
        let token = session?.access_token;
        if (!token) {
          const supabase = getSupabaseBrowserClient();
          if (supabase) {
            try {
              const { data } = await supabase.auth.getSession();
              token = data?.session?.access_token;
            } catch {
              // Proceed without bearer token when browser session lookup fails
            }
          }
        }

        const extractedCodes: SquadCodeDisplayItem[] = [];

        if (returnParams.orderCode !== null) {
          const verifyHeaders: Record<string, string> = {
            "Content-Type": "application/json",
          };
          if (token) {
            verifyHeaders.Authorization = `Bearer ${token}`;
          }

          const verifyRes = await fetch("/api/payments/payos/verify", {
            method: "POST",
            headers: verifyHeaders,
            body: JSON.stringify({ orderCode: returnParams.orderCode }),
          });
          if (!verifyRes.ok) {
            throw new Error("VERIFY_FAILED");
          }
          const verifyData = (await verifyRes.json().catch(() => null)) as {
            ok?: boolean;
            squadCodes?: unknown;
          } | null;
          if (!verifyData?.ok) {
            throw new Error("VERIFY_FAILED");
          }

          if (Array.isArray(verifyData.squadCodes)) {
            for (const entry of verifyData.squadCodes) {
              if (typeof entry === "string" && entry.trim()) {
                extractedCodes.push({ code: entry.trim(), status: "available" });
              }
            }
          }
        }

        const [refreshedTier] = await Promise.all([refreshTier(), refreshQuota()]);
        const tierStr = refreshedTier as string;
        const shouldCheckSquadCodes =
          extractedCodes.length === 0 &&
          (tierStr === "cram_pass" || tierStr === "cram_squad_3" || Boolean(token));

        if (shouldCheckSquadCodes) {
          try {
            const mineHeaders: Record<string, string> = {};
            if (token) {
              mineHeaders.Authorization = `Bearer ${token}`;
            }
            const mineRes = await fetch("/api/payments/squad/mine", {
              method: "GET",
              cache: "no-store",
              ...(Object.keys(mineHeaders).length > 0 ? { headers: mineHeaders } : {}),
            });
            if (mineRes.ok) {
              const mineData = (await mineRes.json().catch(() => null)) as {
                ok?: boolean;
                purchased?: unknown;
              } | null;
              if (mineData?.ok && Array.isArray(mineData.purchased)) {
                for (const item of mineData.purchased) {
                  if (!item || typeof item !== "object") continue;
                  const rec = item as { code?: unknown; status?: unknown };
                  if (typeof rec.code !== "string" || !rec.code.trim()) continue;
                  if (rec.status === "revoked") continue;
                  extractedCodes.push({
                    code: rec.code.trim(),
                    status: rec.status === "redeemed" ? "redeemed" : "available",
                  });
                }
              }
            }
          } catch {
            // Squad invite listing is supplemental; ignore transient failures.
          }
        }

        if (cancelled) return;
        completedRef.current = true;
        setSquadCodes(extractedCodes);
        setPhase("success");
      } catch {
        if (cancelled) return;
        completedRef.current = true;
        setPhase("error");
      }
    };

    void verifyAndSync();

    return () => {
      cancelled = true;
    };
  }, [returnParams, authLoading, session?.access_token, refreshTier, refreshQuota]);

  const handleCopyCode = useCallback((code: string) => {
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      void navigator.clipboard.writeText(code).catch(() => {});
    }
    setCopiedCode(code);
    if (copyTimerRef.current) {
      clearTimeout(copyTimerRef.current);
    }
    copyTimerRef.current = setTimeout(() => setCopiedCode(null), 2000);
  }, []);

  if (dismissed || phase === "idle") {
    return null;
  }

  const isError = phase === "error";
  const isCancelled = phase === "cancelled";
  const isVerifying = phase === "verifying";

  const containerClasses = isError
    ? "border-rose-300 bg-rose-50/90 text-[#1c211a] dark:border-rose-800 dark:bg-rose-950/40 dark:text-stone-50"
    : isCancelled
      ? "border-amber-300 bg-amber-50/90 text-[#1c211a] dark:border-amber-800 dark:bg-amber-950/30 dark:text-stone-50"
      : isVerifying
        ? "border-[#e85d2a]/35 bg-[#fafbf9] text-[#1c211a] dark:border-[#e85d2a]/40 dark:bg-stone-900 dark:text-stone-50"
        : "border-emerald-300 bg-emerald-50/90 text-[#1c211a] dark:border-emerald-800 dark:bg-emerald-950/35 dark:text-stone-50";

  const iconWrapClasses = isError
    ? "bg-rose-100 text-rose-700 dark:bg-rose-900/60 dark:text-rose-300"
    : isCancelled
      ? "bg-amber-100 text-amber-700 dark:bg-amber-900/60 dark:text-amber-300"
      : isVerifying
        ? "bg-[#e85d2a]/12 text-[#e85d2a] dark:bg-[#e85d2a]/20 dark:text-[#ed9a78]"
        : "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/60 dark:text-emerald-300";

  const title = isError
    ? tp.errorTitle
    : isCancelled
      ? tp.cancelledTitle
      : isVerifying
        ? tp.verifyingTitle
        : tp.successTitle;

  const description = isError
    ? tp.errorDesc
    : isCancelled
      ? tp.cancelledDesc
      : isVerifying
        ? tp.verifyingDesc
        : tp.successDesc;

  return (
    <section
      role={isError ? "alert" : "status"}
      aria-live={isError ? "assertive" : "polite"}
      aria-label={title}
      data-testid="payment-return-banner"
      className={`mb-4 rounded-2xl border p-4 shadow-sm transition-colors ${containerClasses}`}
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <div
            className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${iconWrapClasses}`}
          >
            {isVerifying ? (
              <Loader2 size={18} className="animate-spin" aria-hidden="true" />
            ) : isError ? (
              <AlertTriangle size={18} aria-hidden="true" />
            ) : isCancelled ? (
              <XCircle size={18} aria-hidden="true" />
            ) : (
              <CheckCircle2 size={18} aria-hidden="true" />
            )}
          </div>

          <div className="min-w-0 flex-1">
            <h2
              className={`text-sm font-bold text-[#1c211a] dark:text-stone-50 ${FONT_HEADING}`}
            >
              {title}
            </h2>
            <p
              className={`mt-0.5 text-xs leading-relaxed text-[#1c211a]/75 dark:text-stone-300 ${FONT_BODY}`}
            >
              {description}
            </p>

            {phase === "success" && squadCodes.length > 0 && (
              <div className="mt-3 rounded-xl border border-[#e2e5dc] bg-[#fafbf9] p-3 dark:border-stone-800 dark:bg-stone-900/90">
                <p
                  className={`text-xs font-bold text-[#1c211a] dark:text-stone-50 ${FONT_HEADING}`}
                >
                  {tp.squadCodesLabel}
                </p>
                <ul className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {squadCodes.map((item) => {
                    const isCopied = copiedCode === item.code;
                    return (
                      <li
                        key={item.code}
                        className="flex items-center justify-between gap-2 rounded-lg border border-[#e2e5dc] bg-white px-3 py-2 dark:border-stone-700 dark:bg-stone-800/80"
                      >
                        <div className="min-w-0">
                          <div
                            className={`truncate text-xs font-bold tracking-wide text-[#1c211a] dark:text-stone-50 ${FONT_MONO}`}
                          >
                            {item.code}
                          </div>
                          <div
                            className={`text-[11px] font-semibold ${
                              item.status === "available"
                                ? "text-emerald-700 dark:text-emerald-400"
                                : "text-stone-500 dark:text-stone-400"
                            }`}
                          >
                            {item.status === "available"
                              ? tPricing.squadCodeAvailable
                              : tPricing.squadCodeRedeemed}
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => handleCopyCode(item.code)}
                          aria-label={`${tPricing.squadCodeCopy} ${item.code}`}
                          className={`inline-flex shrink-0 cursor-pointer items-center gap-1 rounded-full border border-[#e2e5dc] bg-[#fafbf9] px-2.5 py-1 text-xs font-semibold text-[#1c211a] transition-colors hover:bg-[#eef0e9] dark:border-stone-700 dark:bg-stone-900 dark:text-stone-100 dark:hover:bg-stone-800 ${FONT_HEADING}`}
                        >
                          {isCopied ? (
                            <Check
                              size={12}
                              className="text-emerald-600 dark:text-emerald-400"
                              aria-hidden="true"
                            />
                          ) : (
                            <Copy size={12} aria-hidden="true" />
                          )}
                          <span>
                            {isCopied ? tPricing.squadCodeCopied : tPricing.squadCodeCopy}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
          </div>
        </div>

        {!isVerifying && (
          <div className="flex shrink-0 items-center gap-2 self-end sm:self-start">
            <button
              type="button"
              onClick={() => setDismissed(true)}
              className={`inline-flex cursor-pointer items-center gap-1.5 rounded-full bg-[#e85d2a] px-3.5 py-1.5 text-xs font-bold text-[#fafbf9] transition-colors hover:bg-[#d24f1f] ${FONT_HEADING}`}
            >
              <span>{tp.dismissBtn}</span>
              <X size={13} aria-hidden="true" />
            </button>
          </div>
        )}
      </div>
    </section>
  );
}
