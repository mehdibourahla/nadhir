import { createFileRoute } from "@tanstack/react-router";

import { BroadcastConsole } from "@/components/admin/BroadcastConsole";
import { titledMeta } from "@/lib/page-meta";

export const Route = createFileRoute("/_authenticated/admin/broadcasts")({
  head: () => ({
    meta: titledMeta("broadcastAdmin.title", "broadcastAdmin.subtitle"),
  }),
  component: BroadcastConsole,
});
