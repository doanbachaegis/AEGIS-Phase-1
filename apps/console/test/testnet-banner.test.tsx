import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { TestnetBanner } from "../src/TestnetBanner.js";

/**
 * §4.1 D4 makes "Testnet" and "no real funds" mandatory labels, and §5.1 says that if
 * Week 3 slips, styling is what gets cut — so a styling change is the likeliest way for
 * them to disappear.
 *
 * The assertions therefore run against the rendered TEXT with all markup stripped:
 * classes, element names and nesting can all be rewritten, and these tests still hold.
 * Only deleting or rewording the label breaks them.
 */
function text(markup: string): string {
  return markup
    .replace(/<[^>]*>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

describe("TestnetBanner", () => {
  const rendered = text(renderToStaticMarkup(<TestnetBanner />));

  it('carries the mandatory "Testnet" label', () => {
    expect(rendered).toContain("Testnet");
  });

  it('carries the mandatory "no real funds" label', () => {
    expect(rendered).toContain("no real funds");
  });

  it("survives a restyling: the labels are text, not class names or attributes", () => {
    const markup = renderToStaticMarkup(<TestnetBanner />);
    const withoutText = markup.replace(/>([^<]*)</g, "><");
    expect(withoutText).not.toContain("Testnet");
    expect(withoutText).not.toContain("no real funds");
  });

  it("states that settlement does not reach a real service provider", () => {
    expect(rendered).toContain("nothing is paid to a real digital-service provider");
  });
});
