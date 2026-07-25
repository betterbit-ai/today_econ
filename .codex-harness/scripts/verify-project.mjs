#!/usr/bin/env node

import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

function run(command, cwd) {
  return new Promise((resolvePromise) => {
    const child = spawn(command, {
      cwd,
      shell: true,
      stdio: "inherit",
    });
    child.on("exit", (code, signal) => {
      resolvePromise({ code: code ?? 1, signal });
    });
  });
}

async function main() {
  const projectRoot = resolve(process.argv[2] ?? process.cwd());
  const configPath = join(projectRoot, ".codex-harness", "config.json");
  const config = JSON.parse(await readFile(configPath, "utf8"));
  const commands = config?.verification?.commands ?? [];

  if (commands.length === 0) {
    throw new Error(`No verification commands configured in ${configPath}`);
  }

  for (const check of commands) {
    process.stdout.write(`\n[${check.name}] ${check.command}\n`);
    const result = await run(check.command, projectRoot);
    if (result.code !== 0) {
      throw new Error(
        `${check.name} failed with exit code ${result.code}${
          result.signal ? ` (${result.signal})` : ""
        }`,
      );
    }
  }

  const statePath = join(projectRoot, ".codex-harness", "last-verify.json");
  await mkdir(dirname(statePath), { recursive: true });
  await writeFile(
    statePath,
    `${JSON.stringify(
      {
        verifiedAt: new Date().toISOString(),
        commands: commands.map(({ command }) => command),
      },
      null,
      2,
    )}\n`,
  );
  process.stdout.write("\nAll configured verification checks passed.\n");
}

main().catch((error) => {
  process.stderr.write(`Verification failed: ${error.message}\n`);
  process.exitCode = 1;
});
