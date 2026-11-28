import { describe, expect, it } from "vitest";
import { decodeUnitConversion, encodeUnitConversion } from "./unitConversion";

describe("unit conversion header", () => {
  it.each([
    "16.4041994751 ft",
    "100 °C = 212 °F",
    "50% of 3 m",
    "line one\nline two",
    "5 km ≈ 3.1 mi",
  ])("carries %j through the header unchanged", (answer) => {
    const encoded = encodeUnitConversion(answer);

    // A header value holds no raw control character or non-ASCII byte.
    expect(encoded).toMatch(/^[\x20-\x7e]*$/);
    expect(decodeUnitConversion(encoded)).toBe(answer);
  });

  it.each(["100%", "%E0%A4%A", "%"])(
    "returns nothing for %j, which is not a valid encoding",
    (value) => {
      expect(decodeUnitConversion(value)).toBeUndefined();
    },
  );

  it("returns nothing for a header that holds no text", () => {
    expect(decodeUnitConversion("")).toBeUndefined();
    expect(decodeUnitConversion("%20%20")).toBeUndefined();
  });
});
