import { describe, expect, it } from "vitest";
import { formatMusicRecommendation, musicRecommendation } from "../src/music.js";

describe("music recommendations", () => {
  it("returns a Spotify search link for a recognized request", () => {
    const recommendation = musicRecommendation("recommend an afrobeats song");
    expect(recommendation).toMatchObject({ title: "Essence", artist: "Wizkid ft. Tems" });
    expect(recommendation?.url).toContain("open.spotify.com/search/");
  });

  it("does not hijack ordinary conversation", () => {
    expect(formatMusicRecommendation("I like that song")).toBeUndefined();
  });
});
