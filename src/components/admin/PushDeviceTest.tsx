import { useMutation, useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { myRolesQuery } from "@/lib/reports";
import {
  PushTestError,
  pushTestArrival,
  testPushOnThisDevice,
} from "@/lib/push";

const ARRIVAL_WAIT_MS = 60_000;

export function PushDeviceTest() {
  const { t, i18n } = useTranslation("admin");
  const roles = useQuery(myRolesQuery);
  const test = useMutation({ mutationFn: testPushOnThisDevice, retry: false });
  const expired = () => Date.now() - test.submittedAt > ARRIVAL_WAIT_MS;
  const arrival = useQuery({
    queryKey: ["push_test_arrival", test.data],
    enabled: !!test.data,
    queryFn: () => pushTestArrival(test.data!),
    refetchInterval: (query) => (query.state.data || expired() ? false : 2000),
  });
  const receivedAt = arrival.data;
  if (!roles.data?.includes("admin")) return null;
  return (
    <section className="my-6 rounded-lg border p-4">
      <h2 className="font-medium">{t("sources.pushTestTitle")}</h2>
      <p className="my-2 text-sm text-muted-foreground">
        {t("sources.pushTestHelp")}
      </p>
      <button
        type="button"
        disabled={test.isPending}
        onClick={() => test.mutate()}
        className="rounded bg-primary px-3 py-2 text-sm text-primary-foreground disabled:opacity-50"
      >
        {t(
          test.isPending ? "sources.pushTestWaiting" : "sources.pushTestButton",
        )}
      </button>
      {test.isSuccess && (
        <p role="status" className="mt-2 text-sm">
          {receivedAt
            ? t("sources.pushTestReceived", {
                time: new Date(receivedAt).toLocaleTimeString(i18n.language),
              })
            : t(
                !expired()
                  ? "sources.pushTestAccepted"
                  : arrival.isError
                    ? "sources.pushTestCheckFailed"
                    : "sources.pushTestUnconfirmed",
              )}
        </p>
      )}
      {test.error && (
        <p role="alert" className="mt-2 text-sm text-destructive">
          {t(
            test.error instanceof PushTestError
              ? test.error.message
              : "sources.pushTestErrors.unavailable",
          )}
        </p>
      )}
    </section>
  );
}
