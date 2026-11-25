import { spawnSync } from "node:child_process";
import { REPO_ROOT } from "./lib/env.ts";

const VITEST_CONFIG = "tests/e2e/vitest.e2e.config.ts";
const TIER_DIRS: Record<string, string> = {
  "1": "tests/e2e/tier1",
  "2": "tests/e2e/tier2",
  "3": "tests/e2e/tier3",
  "4": "tests/e2e/tier4",
};

function printUsage(): void {
  console.log(
    [
      "Nadhir E2E Test Runner",
      "",
      "Usage: bun run tests/e2e/run-e2e.ts <mode> [extra vitest args]",
      "",
      "Modes:",
      "  --tier=1         Run Tier 1 feature coverage tests (tests/e2e/tier1)",
      "  --tier=2         Run Tier 2 boundary & corner tests (tests/e2e/tier2)",
      "  --tier=3         Run Tier 3 pairwise interaction tests (tests/e2e/tier3)",
      "  --tier=4         Run Tier 4 Algeria real-world scenarios (tests/e2e/tier4)",
      "  --self           Run E2E harness self-tests (tests/e2e/lib/harness.self.test.ts)",
      "  --all            Run Tiers 1, 2, 3, and 4 sequentially with summary",
      "  --screenshots    Run Playwright 28-screenshot + DOM telemetry capture",
      "  --list           List discovered E2E test files & cases (optionally with --tier=N)",
      "  --help, -h       Show this help message",
    ].join("\n"),
  );
}

function runCommand(command: string, args: string[]): number {
  const result = spawnSync(command, args, {
    cwd: REPO_ROOT,
    stdio: "inherit",
    env: process.env,
  });
  if (result.error) {
    console.error(`Failed to execute ${command}: ${result.error.message}`);
    return 1;
  }
  return result.status ?? 1;
}

function runVitest(targets: string[], extraArgs: string[]): number {
  return runCommand("bunx", [
    "vitest",
    "run",
    "--config",
    VITEST_CONFIG,
    ...targets,
    ...extraArgs,
  ]);
}

function runVitestList(targets: string[], extraArgs: string[]): number {
  return runCommand("bunx", [
    "vitest",
    "list",
    "--config",
    VITEST_CONFIG,
    ...targets,
    ...extraArgs,
  ]);
}

function main(): void {
  const argv = process.argv.slice(2);
  if (argv.length === 0 || argv.includes("--help") || argv.includes("-h")) {
    printUsage();
    process.exit(0);
  }

  let tier: string | null = null;
  let runSelf = false;
  let runAll = false;
  let runScreenshots = false;
  let runList = false;
  const extraArgs: string[] = [];

  for (const arg of argv) {
    if (arg.startsWith("--tier=")) {
      const value = arg.slice("--tier=".length);
      if (!(value in TIER_DIRS)) {
        console.error(`Invalid tier "${value}". Expected 1, 2, 3, or 4.`);
        printUsage();
        process.exit(2);
      }
      tier = value;
    } else if (arg === "--self") {
      runSelf = true;
    } else if (arg === "--all") {
      runAll = true;
    } else if (arg === "--screenshots") {
      runScreenshots = true;
    } else if (arg === "--list") {
      runList = true;
    } else {
      extraArgs.push(arg);
    }
  }

  if (runScreenshots) {
    const code = runCommand("node", [
      "tests/e2e/screenshots/capture-ui.ts",
      ...extraArgs,
    ]);
    process.exit(code);
  }

  if (runList) {
    const targets = tier ? [TIER_DIRS[tier]!] : [];
    const code = runVitestList(targets, extraArgs);
    process.exit(code);
  }

  if (runSelf) {
    const code = runVitest(["tests/e2e/lib/harness.self.test.ts"], extraArgs);
    process.exit(code);
  }

  if (runAll) {
    const summary: Array<{ tier: string; exitCode: number }> = [];
    let firstFailureCode = 0;

    for (const tierNum of ["1", "2", "3", "4"]) {
      const dir = TIER_DIRS[tierNum]!;
      console.log(`\n=== Running E2E Tier ${tierNum} (${dir}) ===`);
      const code = runVitest([dir], extraArgs);
      summary.push({ tier: tierNum, exitCode: code });
      if (code !== 0 && firstFailureCode === 0) {
        firstFailureCode = code;
      }
    }

    console.log("\n=== E2E Suite Summary ===");
    for (const item of summary) {
      const status =
        item.exitCode === 0 ? "PASS" : `FAIL (exit ${item.exitCode})`;
      console.log(`  Tier ${item.tier}: ${status}`);
    }

    process.exit(firstFailureCode);
  }

  if (tier) {
    const code = runVitest([TIER_DIRS[tier]!], extraArgs);
    process.exit(code);
  }

  console.error(`Unrecognized arguments: ${argv.join(" ")}`);
  printUsage();
  process.exit(2);
}

main();
