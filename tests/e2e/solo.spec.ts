import { expect, test, type Page } from "@playwright/test";

test("Enter activates a focused toolbar control without advancing the quiz", async ({
  page,
}) => {
  await start(page);
  await page.keyboard.press("b");
  await expect(page.getByText("That’s a clutch answer.")).toBeVisible();
  await page.getByRole("button", { name: "Mute sound" }).focus();
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("button", { name: "Turn sound on" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: /A café raises/ }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Next question" }).focus();
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("heading", { name: /You spend two hours/ }),
  ).toBeVisible();
});

async function start(page: Page) {
  await page.goto("/");
  try {
    await page.clock.runFor(50);
  } catch {
    // Clock is not installed in un-mocked tests.
  }
  await page.getByRole("button", { name: "Start Clutch Run" }).click();
  await expect(
    page.getByRole("heading", { name: /A café raises/ }),
  ).toBeVisible();
}
async function answerAndAdvance(page: Page, key: string, last = false) {
  await page.keyboard.press(key);
  await expect(page.getByText("That’s a clutch answer.")).toBeVisible();
  await page
    .getByRole("button", { name: last ? "See results" : "Next question" })
    .focus();
  await page.keyboard.press("Enter");
}

test("a perfect keyboard run scores 700 XP, saves once, and restarts cleanly", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await start(page);
  await answerAndAdvance(page, "2");
  await expect(
    page.getByRole("heading", { name: /You spend two hours/ }),
  ).toBeVisible();
  await answerAndAdvance(page, "a");
  await expect(
    page.getByRole("heading", { name: /A binding price ceiling/ }),
  ).toBeVisible();
  await answerAndAdvance(page, "b");
  await expect(
    page.getByRole("heading", { name: /You paid \$20/ }),
  ).toBeVisible();
  await answerAndAdvance(page, "3");
  await expect(
    page.getByRole("heading", { name: /The price of tea/ }),
  ).toBeVisible();
  await answerAndAdvance(page, "d", true);
  await expect(
    page.getByRole("heading", { name: "You came. You clutched." }),
  ).toBeVisible();
  await expect(page.getByText("700", { exact: true })).toBeVisible();
  await expect(page.getByText("100%", { exact: true })).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(
        () => JSON.parse(localStorage.getItem("clutch:runs:v1") || "[]").length,
      ),
    )
    .toBe(1);
  await page.getByRole("button", { name: "Set up another run" }).click();
  await page.getByRole("button", { name: "Start Clutch Run" }).click();
  await expect(page.getByTestId("score")).toHaveText("0 XP");
  await expect(page.getByTestId("lives")).toHaveAttribute(
    "aria-label",
    "3 lives remaining",
  );
  expect(errors).toEqual([]);
});

test("timeout loses one life and enforces four seconds of feedback", async ({
  page,
}) => {
  await page.clock.install();
  await start(page);
  await page.clock.runFor(15_100);
  await expect(
    page.getByText("Time’s up. Take this one with you."),
  ).toBeVisible();
  await expect(page.getByTestId("lives")).toHaveAttribute(
    "aria-label",
    "2 lives remaining",
  );
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("heading", { name: /A café raises/ }),
  ).toBeVisible();
  await page.clock.runFor(4_100);
  await page.keyboard.press("Space");
  await expect(
    page.getByRole("heading", { name: /You spend two hours/ }),
  ).toBeVisible();
});

test("pausing blocks keyboard answers and preserves the timer", async ({
  page,
}) => {
  await page.clock.install();
  await start(page);
  await page.clock.runFor(3_000);
  await page.getByRole("button", { name: "Take a breather" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("2");
  await page.clock.runFor(30_000);
  await expect(page.getByTestId("score")).toHaveText("0 XP");
  await page.getByRole("button", { name: "Resume run" }).click();
  await expect(page.getByTestId("timer")).toContainText("12");
  await page.keyboard.press("b");
  await expect(page.getByText("That’s a clutch answer.")).toBeVisible();
});

test("a missed concept returns in alternate forms until two successes", async ({
  page,
}) => {
  await page.clock.install();
  await start(page);
  await page.keyboard.press("1");
  await expect(page.getByText("A miss is a chance to learn.")).toBeVisible();
  await page.clock.runFor(4_100);
  await page.getByRole("button", { name: "Next question" }).click();
  for (const key of ["a", "b", "c", "d"]) {
    await answerAndAdvance(page, key);
    await page.clock.runFor(300);
  }
  await expect(
    page.getByRole("heading", { name: /A cinema lowers/ }),
  ).toBeVisible();
  await expect(page.getByText("Mastery round", { exact: true })).toBeVisible();
  await answerAndAdvance(page, "c");
  await expect(
    page.getByRole("heading", { name: /A café raises/ }),
  ).toBeVisible();
  await answerAndAdvance(page, "b", true);
  await expect(page.getByText("Reinforced · 2 correct in a row")).toBeVisible();
});

test("variant mode, help, sound preference, and mobile layout work", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/solo");
  await expect(
    page.getByRole("heading", { name: "Less panic. More practice." }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "test-results/mobile-ready.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Mute sound" }).click();
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Turn sound on" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "How to play", exact: true })
    .last()
    .click();
  await expect(
    page.getByRole("dialog", { name: "Your Clutch Run playbook" }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: /Concept remix/ }).click();
  await page.getByRole("button", { name: "Start Clutch Run" }).click();
  await expect(
    page.getByRole("heading", { name: /A cinema lowers/ }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "test-results/mobile-game.png",
    fullPage: true,
  });
});
