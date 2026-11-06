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
import { POST as createRoomHandler } from "@/app/api/arena/rooms/route";
import { GET as getRoomHandler } from "@/app/api/arena/rooms/[code]/route";
import { POST as joinRoomHandler } from "@/app/api/arena/rooms/[code]/join/route";
import { POST as actionHandler } from "@/app/api/arena/rooms/[code]/action/route";
import { GET as streamRoomHandler } from "@/app/api/arena/rooms/[code]/stream/route";
import { createRoom, getPlayerToken } from "@/lib/multiplayer/room-manager";
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
        token: "tok_test_123",
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
          token: "tok_test_123",
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
        token: "tok_test_123",
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
    const hostToken = getPlayerToken(room.code, hostPlayer.id);

    const req = new Request(`http://localhost:3000/api/arena/rooms/${room.code}/action`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        playerId: hostPlayer.id,
        token: hostToken,
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
    const hostToken = getPlayerToken(room.code, hostPlayer.id);

    const req = new Request(`http://localhost:3000/api/arena/rooms/${room.code}/action`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        playerId: hostPlayer.id,
        token: hostToken,
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

  it("POST /api/arena/rooms returns sanitized ArenaRoomState without pack or correctIndex and includes playerToken", async () => {
    vi.mocked(getPartyHost).mockReturnValue(null);

    const req = new Request("http://localhost:3000/api/arena/rooms", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        hostNickname: "SanitizedHost",
        pack: mockMicroeconomics,
      }),
    });

    const res = await createRoomHandler(req);
    expect(res.status).toBe(201);
    const body = await res.json();

    expect(body.ok).toBe(true);
    expect(body.playerToken).toEqual(expect.stringMatching(/^tok_/));
    expect(body.room).toBeDefined();
    expect(body.room.pack).toBeUndefined();
    expect(body.room.playerTokens).toBeUndefined();
    expect(body.room.questions).toBeUndefined();
    expect(JSON.stringify(body.room)).not.toContain("correctIndex");
  });

  it("rejects invalid room codes across [code] route handlers with 400 INVALID_ROOM_CODE without calling PartySocket.fetch", async () => {
    vi.mocked(getPartyHost).mockReturnValue("partykit.clutcharena.dev");

    const invalidCodes = ["__lobby__", "bad-code-123"];

    for (const badCode of invalidCodes) {
      const getRes = await getRoomHandler(
        new Request(`http://localhost:3000/api/arena/rooms/${badCode}`),
        { params: Promise.resolve({ code: badCode }) },
      );
      expect(getRes.status).toBe(400);
      const getBody = await getRes.json();
      expect(getBody.ok).toBe(false);
      expect(getBody.error.code).toBe("INVALID_ROOM_CODE");

      const joinRes = await joinRoomHandler(
        new Request(`http://localhost:3000/api/arena/rooms/${badCode}/join`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ nickname: "Challenger" }),
        }),
        { params: Promise.resolve({ code: badCode }) },
      );
      expect(joinRes.status).toBe(400);
      const joinBody = await joinRes.json();
      expect(joinBody.ok).toBe(false);
      expect(joinBody.error.code).toBe("INVALID_ROOM_CODE");

      const actionRes = await actionHandler(
        new Request(`http://localhost:3000/api/arena/rooms/${badCode}/action`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            playerId: "player_123",
            action: { type: "TOGGLE_READY" },
          }),
        }),
        { params: Promise.resolve({ code: badCode }) },
      );
      expect(actionRes.status).toBe(400);
      const actionBody = await actionRes.json();
      expect(actionBody.ok).toBe(false);
      expect(actionBody.error.code).toBe("INVALID_ROOM_CODE");

      const streamRes = await streamRoomHandler(
        new Request(`http://localhost:3000/api/arena/rooms/${badCode}/stream`),
        { params: Promise.resolve({ code: badCode }) },
      );
      expect(streamRes.status).toBe(400);
      const streamBody = await streamRes.json();
      expect(streamBody.ok).toBe(false);
      expect(streamBody.error.code).toBe("INVALID_ROOM_CODE");
    }

    expect(PartySocket.fetch).not.toHaveBeenCalled();
  });

  it("POST /api/arena/rooms/[code]/action rejects mismatched token with 403 UNAUTHORIZED_PLAYER and accepts valid playerToken", async () => {
    vi.mocked(getPartyHost).mockReturnValue(null);

    const { room, hostPlayer } = createRoom({
      hostNickname: "TokenHost",
      pack: mockMicroeconomics,
    });
    const validToken = getPlayerToken(room.code, hostPlayer.id);
    expect(validToken).toBeTruthy();

    // Rejects mismatched token
    const badReq = new Request(`http://localhost:3000/api/arena/rooms/${room.code}/action`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        playerId: hostPlayer.id,
        token: "tok_wrong_token_value",
        action: { type: "TOGGLE_READY" },
      }),
    });

    const badRes = await actionHandler(badReq, {
      params: Promise.resolve({ code: room.code }),
    });
    expect(badRes.status).toBe(403);
    const badBody = await badRes.json();
    expect(badBody.ok).toBe(false);
    expect(badBody.error.code).toBe("UNAUTHORIZED_PLAYER");

    // Accepts valid token
    const validReq = new Request(`http://localhost:3000/api/arena/rooms/${room.code}/action`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        playerId: hostPlayer.id,
        token: validToken,
        action: { type: "TOGGLE_READY" },
      }),
    });

    const validRes = await actionHandler(validReq, {
      params: Promise.resolve({ code: room.code }),
    });
    expect(validRes.status).toBe(200);
    const validBody = await validRes.json();
    expect(validBody.ok).toBe(true);
    expect(validBody.room.code).toBe(room.code);
  });

  it("POST /api/arena/rooms/[code]/action returns 403 UNAUTHORIZED_PLAYER when token is missing or invalid", async () => {
    vi.mocked(getPartyHost).mockReturnValue(null);

    const { room, hostPlayer } = createRoom({
      hostNickname: "TokenSecurityHost",
      pack: mockMicroeconomics,
    });

    // 1. Missing token completely in payload and headers
    const missingTokenReq = new Request(
      `http://localhost:3000/api/arena/rooms/${room.code}/action`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          playerId: hostPlayer.id,
          action: { type: "START_MATCH" },
        }),
      },
    );

    const missingRes = await actionHandler(missingTokenReq, {
      params: Promise.resolve({ code: room.code }),
    });
    expect(missingRes.status).toBe(403);
    const missingBody = await missingRes.json();
    expect(missingBody.ok).toBe(false);
    expect(missingBody.error.code).toBe("UNAUTHORIZED_PLAYER");
    expect(missingBody.error.message).toBe("Missing or invalid player token.");

    // 2. Invalid token in body
    const invalidTokenReq = new Request(
      `http://localhost:3000/api/arena/rooms/${room.code}/action`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          playerId: hostPlayer.id,
          token: "tok_invalid_fake_token",
          action: { type: "START_MATCH" },
        }),
      },
    );

    const invalidRes = await actionHandler(invalidTokenReq, {
      params: Promise.resolve({ code: room.code }),
    });
    expect(invalidRes.status).toBe(403);
    const invalidBody = await invalidRes.json();
    expect(invalidBody.ok).toBe(false);
    expect(invalidBody.error.code).toBe("UNAUTHORIZED_PLAYER");
    expect(invalidBody.error.message).toBe("Invalid player token.");

    // 3. Valid token passed via x-player-token header succeeds
    const validToken = getPlayerToken(room.code, hostPlayer.id);
    const headerReq = new Request(
      `http://localhost:3000/api/arena/rooms/${room.code}/action`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-player-token": validToken!,
        },
        body: JSON.stringify({
          playerId: hostPlayer.id,
          action: { type: "START_MATCH" },
        }),
      },
    );

    const headerRes = await actionHandler(headerReq, {
      params: Promise.resolve({ code: room.code }),
    });
    expect(headerRes.status).toBe(200);
    const headerBody = await headerRes.json();
    expect(headerBody.ok).toBe(true);
    expect(headerBody.room.status).toBe("countdown");
  });
});
