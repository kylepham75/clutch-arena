import { expect, test } from "@playwright/test";
import { encodePackForShare } from "../../lib/game/pack-transfer";
import type { StudyPack } from "../../lib/schemas/question";

const customPack: StudyPack = {
  id: "test-peer-share-pack",
  title: "Quantum Physics Quick Drill",
  subtitle: "3 rapid questions on wave-particle duality",
  questions: [
    {
      id: "qp-1",
      question: "Which experiment demonstrated the wave nature of light via interference?",
      options: [
        "Young’s Double-Slit Experiment",
        "Rutherford Gold Foil",
        "Michelson-Morley",
        "Cavendish Experiment",
      ],
      correctIndex: 0,
      explanation: "Thomas Young demonstrated light wave interference fringes in 1801.",
      conceptVariant: {
        question: "What pattern appears on screen in Young's double-slit experiment?",
        options: ["Alternating dark and bright bands", "Single dot", "Uniform white", "Random scatter"],
        correctIndex: 0,
        explanation: "Interference between waves produces alternating constructive and destructive fringes.",
      },
    },
    {
      id: "qp-2",
      question: "What is the relation for photon energy E = hf?",
      options: ["Planck-Einstein relation", "Newton's 2nd law", "Ohm's law", "Faraday's law"],
      correctIndex: 0,
      explanation: "Planck's constant relates photon energy directly to wave frequency.",
      conceptVariant: {
        question: "If photon frequency doubles, its energy:",
        options: ["Doubles", "Halves", "Quadruples", "Remains constant"],
        correctIndex: 0,
        explanation: "Energy is strictly proportional to frequency (E = hf).",
      },
    },
  ],
  metadata: {
    "qp-1": {
      topic: "Optics",
      chapter: "Chapter 1",
      citation: "Page 12",
      rule: "Interference demonstrates wave nature.",
    },
    "qp-2": {
      topic: "Photons",
      chapter: "Chapter 2",
      citation: "Page 25",
      rule: "E = hf connects quantum and frequency.",
    },
  },
};

test.describe("Cross-Module Synergies & Workflows", () => {
  test("Flashcard review mode flips cards and records self-ratings", async ({
    page,
  }) => {
    await page.goto("/solo");
    await expect(
      page.getByRole("heading", { name: "Less panic. More practice." }),
    ).toBeVisible();

    // Click Flashcards button on ready screen
    await page.getByRole("button", { name: "Flashcards" }).click();

    // Verify Flashcard Review UI opens
    await expect(page.getByText("Card 1 of 5")).toBeVisible();
    await expect(page.getByText("QUESTION", { exact: true })).toBeVisible();
    await expect(page.getByText("Click or press Space to flip")).toBeVisible();

    // Flip the card
    await page.keyboard.press("Space");
    await expect(page.getByText("ANSWER", { exact: true })).toBeVisible();

    // Rate card as "Got it down" with keyboard shortcut '2'
    await page.keyboard.press("2");
    await expect(page.getByText("Card 2 of 5")).toBeVisible();

    // Flip card 2 and rate as "Still learning" with '1'
    await page.keyboard.press("Space");
    await page.keyboard.press("1");
    await expect(page.getByText("Card 3 of 5")).toBeVisible();

    // Exit back to Solo ready screen
    await page.getByRole("button", { name: "Exit" }).click();
    await expect(
      page.getByRole("heading", { name: "Less panic. More practice." }),
    ).toBeVisible();
  });

  test("Pack Share Dialog opens with link and export options", async ({
    page,
  }) => {
    await page.goto("/solo");
    await expect(
      page.getByRole("heading", { name: "Less panic. More practice." }),
    ).toBeVisible();

    // Click Share button in pack preview
    await page.getByRole("button", { name: "Share" }).click();

    // Verify dialog appears
    await expect(
      page.getByRole("heading", { name: /Share & export/i }),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Copy", exact: true })).toBeVisible();

    // Verify export buttons exist
    await expect(
      page.getByRole("button", { name: /Clutch JSON/ }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: /CSV/ }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: /Anki/ }),
    ).toBeVisible();

    // Close with Escape
    await page.keyboard.press("Escape");
    await expect(
      page.getByRole("heading", { name: /Share & export/i }),
    ).not.toBeVisible();
  });

  test("1-Click 'Host in Arena' switches to Arena with pack pre-selected", async ({
    page,
  }) => {
    await page.goto("/solo");
    await expect(
      page.getByRole("heading", { name: "Less panic. More practice." }),
    ).toBeVisible();

    // Open Study Library
    await page.getByRole("button", { name: "Study library" }).click();
    await expect(
      page.getByRole("heading", { name: "Study Library" }),
    ).toBeVisible();

    // Click "Arena" host button on the sample pack inside library
    const sampleArenaBtn = page.getByTestId("library-host-arena");
    await expect(sampleArenaBtn).toBeVisible();
    await sampleArenaBtn.click();

    // Verify tab switched to Arena and Entrance is visible
    await expect(
      page.getByRole("heading", { name: "Study Arena — Multiplayer" }),
    ).toBeVisible();
    await expect(page.getByText("REAL-TIME STUDY ARENA")).toBeVisible();
    await expect(
      page.getByRole("heading", { name: /Compete live/ }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Launch Arena Room" }),
    ).toBeVisible();
  });

  test("URL share link loads pack from hash peer-to-peer", async ({
    page,
  }) => {
    const token = await encodePackForShare(customPack);
    await page.goto(`/solo#pack=${token}`);

    // Verify shared pack is loaded and title is visible
    await expect(page.getByText("Quantum Physics Quick Drill")).toBeVisible();
    await expect(page.getByText(/wave-particle duality/).first()).toBeVisible();
  });
});
