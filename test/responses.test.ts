import { describe, expect, it } from "vitest";
import { safeReturnTo } from "../src/server/responses.js";

describe("safeReturnTo", () => {
  it("keeps same-origin relative paths with their query and fragment", () => {
    expect(safeReturnTo("/orders?status=open#top")).toBe("/orders?status=open#top");
    expect(safeReturnTo("/%2F%2Fencoded")).toBe("/%2F%2Fencoded");
  });

  it("falls back to the root for missing or absolute values", () => {
    expect(safeReturnTo(null)).toBe("/");
    expect(safeReturnTo("")).toBe("/");
    expect(safeReturnTo("https://evil.example/")).toBe("/");
    expect(safeReturnTo("orders")).toBe("/");
  });

  it("rejects values that browsers resolve to another origin", () => {
    expect(safeReturnTo("//evil.example/")).toBe("/");
    expect(safeReturnTo("/\\evil.example/")).toBe("/");
    expect(safeReturnTo("/\t/evil.example/")).toBe("/");
    expect(safeReturnTo("/\n/evil.example/")).toBe("/");
  });
});
