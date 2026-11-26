import { executeNextSourceJob } from "../src/lib/ingest/source-executor.server";
import { supabaseAdmin } from "../src/integrations/supabase/client.server";
import { sourceJobCommandExitCode } from "../src/lib/source-job-command";
import {
  isSourceExecutionTarget,
  SOURCE_EXECUTION_TARGETS,
} from "../src/lib/source-jobs";
import { sourceJobQueueHasPending } from "../src/lib/source-jobs.server";

const CONTRACT_RE = /^[a-z0-9_.-]{1,80}$/;

const valueAfter = (flag: string): string | undefined => {
  const index = process.argv.indexOf(flag);
  return index < 0 ? undefined : process.argv[index + 1];
};

const hasContractFlag = process.argv.includes("--contract");
const target = valueAfter("--target");
const contract = valueAfter("--contract");

if (!target || !isSourceExecutionTarget(target)) {
  console.error(
    `--target must be one of ${SOURCE_EXECUTION_TARGETS.join(", ")}`,
  );
  process.exit(1);
}
if (hasContractFlag && (!contract || contract.startsWith("--"))) {
  throw new Error(
    "--contract flag requires a value matching /^[a-z0-9_.-]{1,80}$/",
  );
}
if (contract !== undefined && !CONTRACT_RE.test(contract)) {
  console.error("--contract must match /^[a-z0-9_.-]{1,80}$/");
  process.exit(1);
}

const workerScope =
  process.env["GITHUB_RUN_ID"] ?? process.env["WORKER_ID"] ?? "local";
const workerId = `${target}:${workerScope}:${contract ?? "any"}`.slice(0, 200);
const result = await executeNextSourceJob({
  target,
  ...(contract === undefined ? {} : { contractKey: contract }),
  workerId,
});
const commandResult = result.claimed
  ? result
  : {
      ...result,
      pending: await sourceJobQueueHasPending(supabaseAdmin, {
        target,
        ...(contract === undefined ? {} : { contractKey: contract }),
      }),
    };
console.log(JSON.stringify(commandResult));
process.exitCode = sourceJobCommandExitCode(commandResult);
