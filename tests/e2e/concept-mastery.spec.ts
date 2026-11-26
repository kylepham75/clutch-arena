import { expect, test } from "@playwright/test";

test.describe("Concept Mastery & Weak Spot Sprints", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem("clutch:tutorial_completed:v1", "true");
    });
  });

  test("displays concept mastery badges and launches Comeback Sprint when weak spots exist", async ({
    page,
  }) => {
    // Seed localStorage with a weak concept matching mockMicroeconomics
    await page.goto("/");
    await page.evaluate(() => {
      const masteryData = {
        "price elasticity": {
          topic: "Price elasticity",
          totalAttempts: 3,
          correctAttempts: 1,
          lastAttemptedAt: new Date().toISOString(),
          consecutiveCorrect: 0,
          history: [false, true, false],
        },
      };
      localStorage.setItem("clutch:mastery:v1", JSON.stringify(masteryData));
    });

    await page.reload();

    // Load the sample Microeconomics deck from the welcome launchpad
    await page.getByRole("button", { name: "Start Clutch Run" }).click();
    await expect(
      page.getByRole("heading", { name: "Microeconomics essentials" }),
    ).toBeVisible();

    // Verify Deck Concepts aside shows mastery badges
    const deckIntelCard = page.locator(".deck-intel-card");
    await expect(deckIntelCard.getByText("Khái niệm trong bộ đề")).toBeVisible();
    await expect(deckIntelCard.getByText("33% Ôn lại").first()).toBeVisible();

    // Verify Comeback Sprint Ready card is visible
    await expect(page.getByText("Comeback Sprint Ready")).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Launch Comeback Sprint" }),
    ).toBeVisible();

    // Open Progress modal and check Concept Mastery tab
    await page.getByRole("button", { name: "My progress" }).click();
    const progressDialog = page.getByRole("dialog", {
      name: "Every session adds up.",
    });
    await expect(progressDialog).toBeVisible();

    // Switch to Concept Mastery tab
    await progressDialog.getByRole("button", { name: /Concept Mastery/ }).click();
    await expect(
      progressDialog.getByText("Price elasticity"),
    ).toBeVisible();
    await expect(progressDialog.getByText(/1\/3 correct \(33%\)/)).toBeVisible();
    await expect(progressDialog.getByText("Needs Review")).toBeVisible();

    // Close progress modal
    await progressDialog.getByRole("button", { name: "Back to practice" }).click();

    // Launch Comeback Sprint from aside
    await page.getByRole("button", { name: "Launch Comeback Sprint" }).click();

    // Verify sprint has started with a question
    await expect(
      page.getByRole("heading", { name: /A café raises/ }),
    ).toBeVisible();
  });

  test("untested concepts show question-count badges by default", async ({
    page,
  }) => {
    await page.goto("/");
    await page.evaluate(() => {
      localStorage.removeItem("clutch:mastery:v1");
    });
    await page.reload();

    // Load the sample Microeconomics deck from the welcome launchpad
    await page.getByRole("button", { name: "Start Clutch Run" }).click();
    await expect(
      page.getByRole("heading", { name: "Microeconomics essentials" }),
    ).toBeVisible();

    // Badges in deck concept list show question counts ("1 câu") when untested
    const deckConceptList = page.locator(".deck-intel-card .topic-list");
    await expect(deckConceptList.getByText("1 câu").first()).toBeVisible();
    await expect(page.getByText("Comeback Sprint Ready")).not.toBeVisible();
  });
});
