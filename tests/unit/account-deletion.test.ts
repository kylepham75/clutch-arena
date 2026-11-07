import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("server-only", () => ({}));

import * as Sentry from "@sentry/nextjs";
import { DELETE } from "@/app/api/auth/account/route";
import { verifyAuthToken } from "@/lib/auth/server-guard";
import { getSupabaseServerClient } from "@/lib/supabase/server";

vi.mock("@sentry/nextjs", () => ({
  captureException: vi.fn(),
}));

vi.mock("@/lib/auth/server-guard", () => ({
  verifyAuthToken: vi.fn(),
}));

const mockDeletePacksEq = vi.fn();
const mockDeleteRunsEq = vi.fn();
const mockDeleteProfilesEq = vi.fn();
const mockAdminDeleteUser = vi.fn();

const mockSupabaseClient = {
  from: vi.fn((table: string) => {
    if (table === "user_study_packs") {
      return {
        delete: vi.fn(() => ({
          eq: mockDeletePacksEq,
        })),
      };
    }
    if (table === "user_runs") {
      return {
        delete: vi.fn(() => ({
          eq: mockDeleteRunsEq,
        })),
      };
    }
    if (table === "profiles") {
      return {
        delete: vi.fn(() => ({
          eq: mockDeleteProfilesEq,
        })),
      };
    }
    return {
      delete: vi.fn(() => ({
        eq: vi.fn().mockResolvedValue({ error: null }),
      })),
    };
  }),
  auth: {
    admin: {
      deleteUser: mockAdminDeleteUser,
    },
  },
};

vi.mock("@/lib/supabase/server", () => ({
  getSupabaseServerClient: vi.fn(() => mockSupabaseClient),
}));

describe("DELETE /api/auth/account", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv };
    process.env.SUPABASE_SERVICE_ROLE_KEY = "test_service_role_key";

    mockDeletePacksEq.mockResolvedValue({ error: null });
    mockDeleteRunsEq.mockResolvedValue({ error: null });
    mockDeleteProfilesEq.mockResolvedValue({ error: null });
    mockAdminDeleteUser.mockResolvedValue({ error: null });
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("returns 401 UNAUTHORIZED when user is not authenticated", async () => {
    vi.mocked(verifyAuthToken).mockResolvedValueOnce({
      authenticated: false,
      isGuest: true,
      tier: "guest",
      devMode: false,
    });

    const request = new Request("http://localhost:3000/api/auth/account", {
      method: "DELETE",
    });

    const response = await DELETE(request);
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body).toEqual({
      ok: false,
      error: "UNAUTHORIZED",
    });
    expect(mockDeletePacksEq).not.toHaveBeenCalled();
    expect(mockDeleteRunsEq).not.toHaveBeenCalled();
    expect(mockDeleteProfilesEq).not.toHaveBeenCalled();
    expect(mockAdminDeleteUser).not.toHaveBeenCalled();
  });

  it("performs cascade deletion on user_study_packs, user_runs, profiles, and admin.deleteUser when authenticated", async () => {
    vi.mocked(verifyAuthToken).mockResolvedValueOnce({
      authenticated: true,
      user: { id: "user_test_999", email: "student@example.com" } as any,
      token: "test-auth-token",
      tier: "contender",
      tierExpiresAt: null,
    });

    const request = new Request("http://localhost:3000/api/auth/account", {
      method: "DELETE",
      headers: {
        Authorization: "Bearer test-auth-token",
      },
    });

    const response = await DELETE(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      ok: true,
      message: "Account and associated data deleted successfully.",
    });

    expect(mockDeletePacksEq).toHaveBeenCalledWith("user_id", "user_test_999");
    expect(mockDeleteRunsEq).toHaveBeenCalledWith("user_id", "user_test_999");
    expect(mockDeleteProfilesEq).toHaveBeenCalledWith("id", "user_test_999");
    expect(mockAdminDeleteUser).toHaveBeenCalledWith("user_test_999");
  });

  it("skips auth.admin.deleteUser if SUPABASE_SERVICE_ROLE_KEY is absent but cascades db records", async () => {
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;

    vi.mocked(verifyAuthToken).mockResolvedValueOnce({
      authenticated: true,
      user: { id: "user_no_admin_key", email: "student2@example.com" } as any,
      token: "test-auth-token-2",
      tier: "contender",
      tierExpiresAt: null,
    });

    const request = new Request("http://localhost:3000/api/auth/account", {
      method: "DELETE",
    });

    const response = await DELETE(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(mockDeletePacksEq).toHaveBeenCalledWith("user_id", "user_no_admin_key");
    expect(mockDeleteRunsEq).toHaveBeenCalledWith("user_id", "user_no_admin_key");
    expect(mockDeleteProfilesEq).toHaveBeenCalledWith("id", "user_no_admin_key");
    expect(mockAdminDeleteUser).not.toHaveBeenCalled();
  });

  it("captures exception with Sentry and returns 500 when table deletion fails", async () => {
    vi.mocked(verifyAuthToken).mockResolvedValueOnce({
      authenticated: true,
      user: { id: "user_fail_packs", email: "fail@example.com" } as any,
      token: "test-token",
      tier: "contender",
      tierExpiresAt: null,
    });

    mockDeletePacksEq.mockResolvedValueOnce({
      error: new Error("Database foreign key lock failure"),
    });

    const request = new Request("http://localhost:3000/api/auth/account", {
      method: "DELETE",
    });

    const response = await DELETE(request);
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.ok).toBe(false);
    expect(body.error).toContain("Database foreign key lock failure");

    expect(Sentry.captureException).toHaveBeenCalledWith(
      expect.any(Error),
      { tags: { route: "api/auth/account" } }
    );
  });

  it("captures exception with Sentry and returns 500 when auth.admin.deleteUser fails", async () => {
    vi.mocked(verifyAuthToken).mockResolvedValueOnce({
      authenticated: true,
      user: { id: "user_fail_admin", email: "adminfail@example.com" } as any,
      token: "test-token",
      tier: "contender",
      tierExpiresAt: null,
    });

    mockAdminDeleteUser.mockResolvedValueOnce({
      error: new Error("Supabase auth admin error"),
    });

    const request = new Request("http://localhost:3000/api/auth/account", {
      method: "DELETE",
    });

    const response = await DELETE(request);
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.ok).toBe(false);
    expect(body.error).toContain("Supabase auth admin error");

    expect(Sentry.captureException).toHaveBeenCalledWith(
      expect.any(Error),
      { tags: { route: "api/auth/account" } }
    );
  });

  it("captures exception with Sentry and returns 500 when getSupabaseServerClient returns null", async () => {
    vi.mocked(verifyAuthToken).mockResolvedValueOnce({
      authenticated: true,
      user: { id: "user_no_supabase", email: "nosupabase@example.com" } as any,
      token: "test-token",
      tier: "contender",
      tierExpiresAt: null,
    });

    vi.mocked(getSupabaseServerClient).mockReturnValueOnce(null);

    const request = new Request("http://localhost:3000/api/auth/account", {
      method: "DELETE",
    });

    const response = await DELETE(request);
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.ok).toBe(false);
    expect(body.error).toBe("Supabase server client unavailable.");
    expect(Sentry.captureException).toHaveBeenCalledWith(
      expect.any(Error),
      { tags: { route: "api/auth/account" } }
    );
  });
});
