import { describe, expect, it } from "vitest";
import { extractPassToken, passUrl } from "../pass";

const token = "0123456789abcdef0123456789abcdef";

describe("pass links", () => {
  it("builds a link without doubled slashes", () => {
    expect(passUrl(token, "https://parademarshall.vercel.app/")).toBe(`https://parademarshall.vercel.app/pass/${token}`);
  });

  it("reads tokens from links, bare codes and sign links", () => {
    expect(extractPassToken(passUrl(token, "https://x.test"))).toBe(token);
    expect(extractPassToken(` ${token}\n`)).toBe(token);
    expect(extractPassToken(`https://x.test/pass/${token}/sign`)).toBe(token);
    expect(extractPassToken(`https://x.test/pass/${token}?a=1`)).toBe(token);
  });

  it("rejects anything else", () => {
    expect(extractPassToken("https://evil.test/pass/short")).toBeNull();
    expect(extractPassToken(`${token}0`)).toBeNull();
    expect(extractPassToken("hello")).toBeNull();
  });
});
