import { expect, test } from "@playwright/test";
import {
  mockMicroeconomics,
  mockMicroeconomicsDoc,
} from "../../data/mock-microeconomics";

test.describe("Study Arena — Multiplayer E2E", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem("clutch:tutorial_completed:v1", "true");
    });
  });

  test("creates an arena room, adds a bot, and enters live match", async ({
    page,
  }) => {
    // Seed a study pack in local library so /arena can select it directly
    await page.addInitScript(
      ({ pack, doc }) => {
        localStorage.setItem(
          "clutch:library:v1",
          JSON.stringify([
            {
              id: pack.id,
              title: pack.title,
              createdAt: "2026-01-01T00:00:00.000Z",
              questionCount: pack.questions.length,
              format: doc.format,
              fileName: doc.fileName,
              pack,
              document: doc,
            },
          ]),
        );
      },
      { pack: mockMicroeconomics, doc: mockMicroeconomicsDoc },
    );

    // Navigate to /arena
    await page.goto("/arena");

    // Verify Arena entrance
    await expect(page.getByText("MULTIPLAYER STUDY ARENA")).toBeVisible();
    await expect(page.getByRole("button", { name: "Launch Arena Room" })).toBeVisible();

    // Set host nickname
    const nicknameInput = page.locator("#arena-nickname");
    await nicknameInput.fill("ArenaChampion");

    // Launch Arena Room
    await page.getByRole("button", { name: "Launch Arena Room" }).click();

    // Verify lobby view
    await expect(page.getByText("MULTIPLAYER STUDY ARENA LOBBY")).toBeVisible();
    await expect(page.getByText("ArenaChampion")).toBeVisible();
    await expect(page.getByText("Arena Host")).toBeVisible();

    // Add Practice Bot
    await page.getByRole("button", { name: "Add Practice Bot" }).click();
    await expect(page.getByText("AI Practice Bot")).toBeVisible();
    await expect(page.getByText("2 player(s) joined")).toBeVisible();

    // Start Arena Match
    await page.getByRole("button", { name: /Start Arena Match/ }).click();

    // Verify game starts (countdown or question)
    await expect(
      page.getByText(/MATCH STARTING|QUESTION 1 OF/i),
    ).toBeVisible({ timeout: 10_000 });

    // Wait for question to become active (after 3s countdown)
    await expect(page.getByText(/QUESTION 1 OF/i)).toBeVisible({
      timeout: 8_000,
    });

    // Verify anti-cheat: questions and options are visible, choose option A
    const firstOption = page.locator(".arena-option").first();
    await expect(firstOption).toBeVisible();
    await firstOption.click();

    // Verify locked in status banner
    await expect(
      page.getByText("Answer locked in! Waiting for other contenders…"),
    ).toBeVisible();

    // Wait for round feedback
    await expect(page.locator(".arena-round-feedback")).toBeVisible({
      timeout: 16_000,
    });
    await expect(page.getByText(/Next round in 4s…/i)).toBeVisible();
  });

  test("API endpoints enforce server-authoritative rules and validation", async ({
    request,
  }) => {
    // 1. Create room via API
    const createRes = await request.post("/api/arena/rooms", {
      data: {
        nickname: "APITester",
        avatar: "⚡",
        mode: "exact",
      },
    });
    expect(createRes.status()).toBe(201);
    const createData = await createRes.json();
    expect(createData.ok).toBe(true);
    expect(createData.room.code).toBeDefined();
    expect(createData.playerToken).toBeDefined();

    const roomCode = createData.room.code;
    const hostPlayer = createData.player;
    const hostToken: string = createData.playerToken;

    // 2. Fetch room state via API
    const getRes = await request.get(`/api/arena/rooms/${roomCode}`);
    expect(getRes.status()).toBe(200);
    const getData = await getRes.json();
    expect(getData.room.status).toBe("lobby");
    expect(getData.room.players[hostPlayer.id].nickname).toBe("APITester");

    // 3. Join another player
    const joinRes = await request.post(`/api/arena/rooms/${roomCode}/join`, {
      data: {
        nickname: "SecondPlayer",
        avatar: "🎯",
      },
    });
    expect(joinRes.status()).toBe(200);
    const joinData = await joinRes.json();
    expect(joinData.ok).toBe(true);
    expect(joinData.playerToken).toBeDefined();
    const secondPlayer = joinData.player;
    const secondToken: string = joinData.playerToken;

    // 3b. Missing/invalid player token and non-host host-only actions return 403
    const missingTokenRes = await request.post(`/api/arena/rooms/${roomCode}/action`, {
      data: {
        action: "ADD_BOT",
        playerId: hostPlayer.id,
      },
    });
    expect(missingTokenRes.status()).toBe(403);

    const invalidTokenRes = await request.post(`/api/arena/rooms/${roomCode}/action`, {
      headers: { "x-player-token": "invalid-token" },
      data: {
        action: "ADD_BOT",
        playerId: hostPlayer.id,
      },
    });
    expect(invalidTokenRes.status()).toBe(403);

    const nonHostBotRes = await request.post(`/api/arena/rooms/${roomCode}/action`, {
      data: {
        action: "ADD_BOT",
        playerId: secondPlayer.id,
        token: secondToken,
      },
    });
    expect(nonHostBotRes.status()).toBe(403);

    // 4. Add bot action (authenticated host token)
    const addBotRes = await request.post(`/api/arena/rooms/${roomCode}/action`, {
      data: {
        action: "ADD_BOT",
        playerId: hostPlayer.id,
        token: hostToken,
      },
    });
    expect(addBotRes.status()).toBe(200);

    // 5. Start match action (authenticated host token via header)
    const startRes = await request.post(`/api/arena/rooms/${roomCode}/action`, {
      headers: { "x-player-token": hostToken },
      data: {
        action: "START_MATCH",
        playerId: hostPlayer.id,
      },
    });
    expect(startRes.status()).toBe(200);

    // 6. Verify room is in countdown or answering and anti-cheat is active
    const activeRes = await request.get(`/api/arena/rooms/${roomCode}`);
    const activeData = await activeRes.json();
    expect(["countdown", "answering"]).toContain(activeData.room.status);

    if (activeData.room.currentQuestion) {
      // Must not leak correct answer
      expect(activeData.room.currentQuestion.correctIndex).toBeUndefined();
      expect(activeData.room.currentQuestion.explanation).toBeUndefined();
    }
  });

  test("switch between Solo practice and Arena tab from sidebar", async ({
    page,
  }) => {
    await page.goto("/solo");

    // Click Study Arena tab in sidebar
    await page.getByRole("button", { name: /Study Arena/i }).click();

    // Verify Arena view is rendered
    await expect(page.getByRole("heading", { name: "Study Arena" })).toBeVisible();
    await expect(page.getByText("Arena live")).toBeVisible();
    await expect(page.getByRole("button", { name: "Launch Arena Room" })).toBeVisible();
  });
});
