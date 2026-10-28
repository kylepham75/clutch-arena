import { describe, expect, it, vi, beforeEach } from "vitest";
import { cleanAuthUrlFromBrowserHistory } from "@/lib/auth/clean-url";

describe("cleanAuthUrlFromBrowserHistory", () => {
  let replaceStateSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    replaceStateSpy = vi.fn();
    (globalThis as any).window = {
      location: new URL("https://clutch-arena-rho.vercel.app/"),
      history: {
        replaceState: replaceStateSpy,
      },
    };
  });

  it("strips sensitive OAuth hash fragments containing access_token, refresh_token, and provider_token", () => {
    (globalThis as any).window.location = new URL(
      "https://clutch-arena-rho.vercel.app/#access_token=secret_jwt&refresh_token=secret_refresh&provider_token=ya29.google_secret&expires_in=3600&token_type=bearer",
    );

    cleanAuthUrlFromBrowserHistory();

    expect(replaceStateSpy).toHaveBeenCalledTimes(1);
    expect(replaceStateSpy).toHaveBeenCalledWith(null, "", "/");
  });

  it("strips OAuth PKCE code parameter from search params while preserving normal query parameters", () => {
    (globalThis as any).window.location = new URL(
      "https://clutch-arena-rho.vercel.app/arena?code=auth_exchange_code_123&room=CODE99",
    );

    cleanAuthUrlFromBrowserHistory();

    expect(replaceStateSpy).toHaveBeenCalledTimes(1);
    expect(replaceStateSpy).toHaveBeenCalledWith(null, "", "/arena?room=CODE99");
  });

  it("strips OAuth error descriptions from both hash and query parameters", () => {
    (globalThis as any).window.location = new URL(
      "https://clutch-arena-rho.vercel.app/#error=access_denied&error_description=User+declined",
    );

    cleanAuthUrlFromBrowserHistory();

    expect(replaceStateSpy).toHaveBeenCalledTimes(1);
    expect(replaceStateSpy).toHaveBeenCalledWith(null, "", "/");
  });

  it("does not mutate history if the URL has neither auth tokens nor auth query parameters", () => {
    (globalThis as any).window.location = new URL(
      "https://clutch-arena-rho.vercel.app/solo?deck=economics-101#slide-3",
    );

    cleanAuthUrlFromBrowserHistory();

    expect(replaceStateSpy).not.toHaveBeenCalled();
  });
});
