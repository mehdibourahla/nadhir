import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";

export function LoadMore({
  query,
}: {
  query: {
    hasNextPage: boolean;
    isFetchingNextPage: boolean;
    fetchNextPage: () => unknown;
  };
}) {
  const { t } = useTranslation();
  if (!query.hasNextPage) return null;
  return (
    <Button
      type="button"
      variant="outline"
      className="mt-3 w-full"
      disabled={query.isFetchingNextPage}
      onClick={() => void query.fetchNextPage()}
    >
      {t(query.isFetchingNextPage ? "common.loading" : "common.loadMore")}
    </Button>
  );
}
