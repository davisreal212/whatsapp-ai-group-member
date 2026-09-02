export interface MusicRecommendation {
  title: string;
  artist: string;
  url: string;
}

export function isMusicRequestText(text: string): boolean {
  return /\b(?:recommend|suggest|send|share|find|get|play)\b[\s\S]{0,80}\b(?:song|music|track|playlist)\b/i.test(text)
    || /\b(?:song|music|track|playlist)\b[\s\S]{0,80}\b(?:for|to listen|on spotify)\b/i.test(text);
}

export function musicRecommendation(text: string): MusicRecommendation | undefined {
  if (!isMusicRequestText(text)) return undefined;
  const normalized = text.toLowerCase();
  const recommendation = normalized.includes("workout") || normalized.includes("gym")
    ? { title: "Till I Collapse", artist: "Eminem" }
    : normalized.includes("chill") || normalized.includes("relax")
      ? { title: "Sunset Lover", artist: "Petit Biscuit" }
      : normalized.includes("love") || normalized.includes("romantic")
        ? { title: "Adore You", artist: "Harry Styles" }
        : normalized.includes("afrobeats") || normalized.includes("afrobeat")
          ? { title: "Essence", artist: "Wizkid ft. Tems" }
          : { title: "Calm Down", artist: "Rema & Selena Gomez" };
  return {
    ...recommendation,
    url: `https://open.spotify.com/search/${encodeURIComponent(`${recommendation.title} ${recommendation.artist}`)}`,
  };
}

export function formatMusicRecommendation(text: string): string | undefined {
  const recommendation = musicRecommendation(text);
  if (!recommendation) return undefined;
  return `Try ${recommendation.title} by ${recommendation.artist}: ${recommendation.url}`;
}
