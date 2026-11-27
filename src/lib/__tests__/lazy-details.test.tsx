import { expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { LazyDetails } from "@/components/LazyDetails";

it("keeps collapsed rows out of initial HTML", () => {
  const html = renderToStaticMarkup(
    <LazyDetails summary={<span>Wilaya</span>}>
      <span>Expensive commune rows</span>
    </LazyDetails>,
  );
  expect(html).toContain("Wilaya");
  expect(html).toContain("<summary><span>Wilaya</span></summary>");
  expect(html).not.toContain("Expensive commune rows");
});
