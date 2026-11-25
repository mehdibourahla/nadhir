import { createFileRoute } from "@tanstack/react-router";

import { buildSitemapXml } from "@/lib/sitemap";

const XML_HEADERS = {
  "Content-Type": "application/xml; charset=utf-8",
  "Cache-Control": "public, max-age=3600",
} as const;

export const Route = createFileRoute("/sitemap.xml")({
  server: {
    handlers: {
      GET: () =>
        new Response(buildSitemapXml(), {
          status: 200,
          headers: XML_HEADERS,
        }),
      HEAD: () =>
        new Response(null, {
          status: 200,
          headers: XML_HEADERS,
        }),
      OPTIONS: () =>
        new Response(null, {
          status: 204,
          headers: { Allow: "GET, HEAD, OPTIONS" },
        }),
      ANY: () =>
        new Response("Method Not Allowed", {
          status: 405,
          headers: { Allow: "GET, HEAD, OPTIONS" },
        }),
    },
  },
});
