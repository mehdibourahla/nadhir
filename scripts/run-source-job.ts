import { executeNextSourceJob } from "../src/lib/ingest/source-executor.server";
import { supabaseAdmin } from "../src/integrations/supabase/client.server";
import { sourceJobCommandExitCode } from "../src/lib/source-job-command";
import { sourceJobQueueHasPending } from "../src/lib/source-jobs.server";

const valueAfter = (flag: string): string | undefined => {
  const index = process.argv.indexOf(flag);
  return index < 0 ? undefined : process.argv[index + 1];
};

const target = valueAfter("--target");
const contract = valueAfter("--contract");

if (target !== "github") {
  console.error("--target must be github");
  process.exit(1);
}
if (
  contract !== "local_fwi" &&
  contract !== "effis" &&
  contract !== "ita_facebook"
) {
  console.error("--contract must be local_fwi, effis or ita_facebook");
  process.exit(1);
}

const result = await executeNextSourceJob({
  target,
  contractKey: contract,
  workerId: `github:${process.env["GITHUB_RUN_ID"] ?? "local"}:${contract}`,
});
const commandResult = result.claimed
  ? result
  : {
      ...result,
      pending: await sourceJobQueueHasPending(supabaseAdmin, {
        target,
        contractKey: contract,
      }),
    };
console.log(JSON.stringify(commandResult));
process.exitCode = sourceJobCommandExitCode(commandResult);
