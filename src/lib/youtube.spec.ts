import { describe, it, expect } from "vitest";
import { isYouTubeUrl, extractVideoId } from "./youtube";

describe("isYouTubeUrl", () => {
  it("should recognize standard watch URLs", () => {
    expect(isYouTubeUrl("https://www.youtube.com/watch?v=dQw4w9WgXcQ")).toBe(true);
    expect(isYouTubeUrl("https://youtube.com/watch?v=dQw4w9WgXcQ")).toBe(true);
    expect(isYouTubeUrl("http://youtube.com/watch?v=dQw4w9WgXcQ")).toBe(true);
  });

  it("should recognize short URLs", () => {
    expect(isYouTubeUrl("https://youtu.be/dQw4w9WgXcQ")).toBe(true);
  });

  it("should recognize embed URLs", () => {
    expect(isYouTubeUrl("https://youtube.com/embed/dQw4w9WgXcQ")).toBe(true);
  });

  it("should recognize shorts URLs", () => {
    expect(isYouTubeUrl("https://youtube.com/shorts/dQw4w9WgXcQ")).toBe(true);
  });

  it("should reject non-YouTube URLs", () => {
    expect(isYouTubeUrl("https://vimeo.com/123456")).toBe(false);
    expect(isYouTubeUrl("https://google.com")).toBe(false);
    expect(isYouTubeUrl("not a url")).toBe(false);
  });
});

describe("extractVideoId", () => {
  it("should extract ID from standard watch URLs", () => {
    expect(extractVideoId("https://www.youtube.com/watch?v=dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
    expect(extractVideoId("https://youtube.com/watch?v=abc123XYZ")).toBe("abc123XYZ");
  });

  it("should extract ID from URLs with additional parameters", () => {
    expect(extractVideoId("https://youtube.com/watch?v=dQw4w9WgXcQ&t=120")).toBe("dQw4w9WgXcQ");
    expect(extractVideoId("https://youtube.com/watch?v=dQw4w9WgXcQ&list=PLtest")).toBe("dQw4w9WgXcQ");
  });

  it("should extract ID from short URLs", () => {
    expect(extractVideoId("https://youtu.be/dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
    expect(extractVideoId("https://youtu.be/dQw4w9WgXcQ?t=30")).toBe("dQw4w9WgXcQ");
  });

  it("should extract ID from embed URLs", () => {
    expect(extractVideoId("https://youtube.com/embed/dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
  });

  it("should extract ID from shorts URLs", () => {
    expect(extractVideoId("https://youtube.com/shorts/dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
  });

  it("should return null for invalid URLs", () => {
    expect(extractVideoId("https://vimeo.com/123456")).toBe(null);
    expect(extractVideoId("not a url")).toBe(null);
    expect(extractVideoId("")).toBe(null);
  });
});
