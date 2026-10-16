import { expect, test } from "@playwright/test";

test.describe("Concept Mastery & Weak Spot Sprints", () => {
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

    // Verify Deck Concepts aside shows mastery badges
    await expect(page.getByText("DECK CONCEPTS")).toBeVisible();
    await expect(page.getByText("33% Needs Review").first()).toBeVisible();

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
    await expect(progressDialog.getByText("33% Needs Review")).toBeVisible();

    // Close progress modal
    await progressDialog.getByRole("button", { name: "Back to practice" }).click();

    // Launch Comeback Sprint from aside
    await page.getByRole("button", { name: "Launch Comeback Sprint" }).click();

    // Verify sprint has started with a question
    await expect(
      page.getByRole("heading", { name: /A café raises/ }),
    ).toBeVisible();
  });

  test("untested concepts show New badges by default", async ({ page }) => {
    await page.goto("/");
    await page.evaluate(() => {
      localStorage.removeItem("clutch:mastery:v1");
    });
    await page.reload();

    // Badges in deck concept list should show "New"
    const newBadges = page.locator(".badge-untested");
    await expect(newBadges.first()).toBeVisible();
    await expect(newBadges.first()).toHaveText("New");
  });
});
