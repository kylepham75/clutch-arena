import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";

vi.mock("server-only", () => ({}));

vi.mock("partysocket", () => ({
  default: {
    fetch: vi.fn(),
  },
}));

vi.mock("@/lib/multiplayer/party-config", () => ({
  getPartyHost: vi.fn(),
  isPartyKitConfigured: vi.fn(),
}));

import PartySocket from "partysocket";
import { getPartyHost } from "@/lib/multiplayer/party-config";
import { POST as actionHandler } from "@/app/api/arena/rooms/[code]/action/route";
import { createRoom } from "@/lib/multiplayer/room-manager";
import { mockMicroeconomics } from "@/data/mock-microeconomics";

describe("Arena Action Forwarding to PartyKit", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("forwards valid action to PartyKit when party host is configured", async () => {
    vi.mocked(getPartyHost).mockReturnValue("partykit.clutcharena.dev");

    const mockPartyKitResponse = {
      ok: true,
      room: { code: "PARTY1", status: "countdown" },
    };

    vi.mocked(PartySocket.fetch).mockResolvedValueOnce(
      new Response(JSON.stringify(mockPartyKitResponse), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const req = new Request("http://localhost:3000/api/arena/rooms/party1/action", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        playerId: "player_123",
        action: { type: "START_MATCH" },
      }),
    });

    const res = await actionHandler(req, {
      params: Promise.resolve({ code: "party1" }),
    });

    expect(PartySocket.fetch).toHaveBeenCalledTimes(1);
    expect(PartySocket.fetch).toHaveBeenCalledWith(
      {
        host: "partykit.clutcharena.dev",
        party: "arena",
        room: "PARTY1",
        path: "/action",
      },
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          playerId: "player_123",
          action: { type: "START_MATCH" },
        }),
      },
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual(mockPartyKitResponse);
  });

  it("returns PartyKit status code and payload when action is rejected by PartyKit", async () => {
    vi.mocked(getPartyHost).mockReturnValue("partykit.clutcharena.dev");

    const mockPartyKitError = {
      ok: false,
      error: { message: "Action rejected." },
    };

    vi.mocked(PartySocket.fetch).mockResolvedValueOnce(
      new Response(JSON.stringify(mockPartyKitError), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const req = new Request("http://localhost:3000/api/arena/rooms/party1/action", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        playerId: "player_not_host",
        action: { type: "START_MATCH" },
      }),
    });

    const res = await actionHandler(req, {
      params: Promise.resolve({ code: "party1" }),
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toEqual(mockPartyKitError);
  });

  it("falls back to local room manager if PartySocket.fetch throws", async () => {
    vi.mocked(getPartyHost).mockReturnValue("partykit.clutcharena.dev");
    vi.mocked(PartySocket.fetch).mockRejectedValueOnce(
      new Error("PartyKit server connection timed out"),
    );

    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    // Create local room for fallback
    const { room, hostPlayer } = createRoom({
      hostNickname: "FallbackHost",
      pack: mockMicroeconomics,
    });

    const req = new Request(`http://localhost:3000/api/arena/rooms/${room.code}/action`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        playerId: hostPlayer.id,
        action: { type: "START_MATCH" },
      }),
    });

    const res = await actionHandler(req, {
      params: Promise.resolve({ code: room.code }),
    });

    expect(consoleErrorSpy).toHaveBeenCalled();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.room.status).toBe("countdown");
  });

  it("uses local room manager directly when getPartyHost returns null", async () => {
    vi.mocked(getPartyHost).mockReturnValue(null);

    const { room, hostPlayer } = createRoom({
      hostNickname: "LocalHost",
      pack: mockMicroeconomics,
    });

    const req = new Request(`http://localhost:3000/api/arena/rooms/${room.code}/action`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        playerId: hostPlayer.id,
        action: { type: "TOGGLE_READY" },
      }),
    });

    const res = await actionHandler(req, {
      params: Promise.resolve({ code: room.code }),
    });

    expect(PartySocket.fetch).not.toHaveBeenCalled();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.room.code).toBe(room.code);
  });

  it("validates payload before attempting PartyKit forwarding and returns 400 on invalid input", async () => {
    vi.mocked(getPartyHost).mockReturnValue("partykit.clutcharena.dev");

    const req = new Request("http://localhost:3000/api/arena/rooms/any123/action", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        // missing playerId
        action: { type: "START_MATCH" },
      }),
    });

    const res = await actionHandler(req, {
      params: Promise.resolve({ code: "any123" }),
    });

    expect(PartySocket.fetch).not.toHaveBeenCalled();
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error).toBeDefined();
  });
});
