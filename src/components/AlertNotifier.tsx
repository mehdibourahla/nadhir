import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  startAlertNotifications,
  type PersonalNotification,
} from "@/lib/alert-notifications";

export function AlertNotifier() {
  const qc = useQueryClient();
  useEffect(
    () =>
      startAlertNotifications({
        onUser: (change) => {
          let alive = true;
          const { data } = supabase.auth.onAuthStateChange(
            (_event, session) => {
              queueMicrotask(() => {
                if (alive) change(session?.user.id ?? null);
              });
            },
          );
          return () => {
            alive = false;
            data.subscription.unsubscribe();
          };
        },
        subscribe: (id, receive) => {
          const channel = supabase
            .channel(`alerts-${id}`)
            .on(
              "postgres_changes",
              {
                event: "INSERT",
                schema: "public",
                table: "alerts",
                filter: `user_id=eq.${id}`,
              },
              (payload) => {
                void receive(payload.new as PersonalNotification).catch(
                  (error: unknown) => {
                    console.error(
                      "Personal alert preference lookup failed",
                      error,
                    );
                  },
                );
              },
            )
            .subscribe();
          return () => {
            void supabase.removeChannel(channel);
          };
        },
        pushEnabled: async (id) => {
          const { data, error } = await supabase
            .from("profiles")
            .select("alert_push")
            .eq("id", id)
            .maybeSingle();
          if (error) throw new Error("Personal alert preference unavailable");
          return data?.alert_push === true;
        },
        refresh: () => {
          void qc.invalidateQueries({ queryKey: ["alerts"] });
        },
        show: (alert) => {
          if (
            typeof Notification === "undefined" ||
            Notification.permission !== "granted"
          )
            return;
          try {
            new Notification(alert.title, { body: alert.body, tag: alert.id });
          } catch {
            /* Some browsers require service-worker delivery. */
          }
        },
      }),
    [qc],
  );
  return null;
}
