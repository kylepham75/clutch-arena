import { describe, expect, it } from "vitest";
import { pointsForStreak, streakLabel } from "@/lib/game/scoring";
describe("streak scoring", () => {
  it.each([
    [1, 100],
    [2, 100],
    [3, 150],
    [4, 150],
    [5, 200],
    [6, 200],
    [7, 200],
  ])("awards %i-streak points", (streak, points) =>
    expect(pointsForStreak(streak)).toBe(points),
  );
  it("marks seven answers as ON FIRE", () => {
    expect(streakLabel(7)).toBe("ON FIRE");
    expect(streakLabel(3)).toBe("1.5×");
  });
});
