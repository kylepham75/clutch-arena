import { expect, test } from "@playwright/test";

test.describe("Study Arena — Multiplayer E2E", () => {
  test("creates an arena room, adds a bot, and enters live match", async ({
    page,
  }) => {
    // Navigate to /arena
    await page.goto("/arena");

    // Verify Arena entrance
    await expect(page.getByText("REAL-TIME STUDY ARENA")).toBeVisible();
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
    await expect(page.getByText("2 players joined")).toBeVisible();

    // Start Arena Match
    await page.getByRole("button", { name: /Start Arena Match/ }).click();

    // Verify game starts (countdown or question)
    await expect(
      page.getByText(/MATCH STARTING IN|QUESTION 1 OF/i),
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

    const roomCode = createData.room.code;
    const hostPlayer = createData.player;

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
    const secondPlayer = joinData.player;

    // 4. Add bot action
    const addBotRes = await request.post(`/api/arena/rooms/${roomCode}/action`, {
      data: {
        action: "ADD_BOT",
        playerId: hostPlayer.id,
      },
    });
    expect(addBotRes.status()).toBe(200);

    // 5. Start match action
    const startRes = await request.post(`/api/arena/rooms/${roomCode}/action`, {
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
    await expect(page.getByText("REAL-TIME STUDY ARENA")).toBeVisible();
    await expect(page.getByText("ARENA LIVE")).toBeVisible();
  });
});
