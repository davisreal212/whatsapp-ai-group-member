import { describe, expect, it } from "vitest";
import { isSafeHttpsUrl } from "../src/network.js";

describe("safe media URLs", () => {
  it("accepts ordinary HTTPS hosts", () => {
    expect(isSafeHttpsUrl("https://cdn.example.com/image.png")).toBe(true);
  });

  it("rejects non-HTTPS, private, and credential-bearing URLs", () => {
    expect(isSafeHttpsUrl("http://cdn.example.com/image.png")).toBe(false);
    expect(isSafeHttpsUrl("https://localhost/image.png")).toBe(false);
    expect(isSafeHttpsUrl("https://10.0.0.1/image.png")).toBe(false);
    expect(isSafeHttpsUrl("https://user:pass@cdn.example.com/image.png")).toBe(false);
    expect(isSafeHttpsUrl("https://cdn.example.com:8443/image.png")).toBe(false);
  });
});
