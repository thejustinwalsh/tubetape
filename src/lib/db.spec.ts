import { describe, it, expect } from "vitest";
import { generateSampleId } from "./db";

describe("generateSampleId", () => {
  it("should start with 'sample-' prefix", () => {
    const id = generateSampleId();

    expect(id.startsWith("sample-")).toBe(true);
  });

  it("should generate unique IDs", () => {
    const ids = new Set<string>();

    for (let i = 0; i < 100; i++) {
      ids.add(generateSampleId());
    }

    expect(ids.size).toBe(100);
  });

  it("should have reasonable length", () => {
    const id = generateSampleId();

    expect(id.length).toBeGreaterThan(10);
    expect(id.length).toBeLessThan(100);
  });
});
