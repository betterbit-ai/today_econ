#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { access, readFile } from "node:fs/promises";
import { constants } from "node:fs";
import { extname, join, parse, relative, resolve, sep } from "node:path";

async function exists(path) {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function repositoryRoot(cwd) {
  try {
    return execFileSync("git", ["-C", cwd, "rev-parse", "--show-toplevel"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return null;
  }
}

function changedFiles(projectRoot) {
  try {
    return execFileSync(
      "git",
      ["-C", projectRoot, "status", "--porcelain=v1", "--untracked-files=all"],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
    )
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => line.slice(3))
      .map((path) => path.includes(" -> ") ? path.split(" -> ").at(-1) : path);
  } catch {
    return [];
  }
}

function isTestFile(path) {
  return /(?:^|\/)(?:tests?|__tests__)(?:\/|$)/.test(path) ||
    /\.(?:test|spec)\.[^.]+$/.test(path) ||
    /_test\.(?:go|py)$/.test(path);
}

async function hasAdjacentTest(projectRoot, file) {
  const parsed = parse(join(projectRoot, file));
  const candidates = [
    join(parsed.dir, `${parsed.name}.test${parsed.ext}`),
    join(parsed.dir, `${parsed.name}.spec${parsed.ext}`),
    join(parsed.dir, `${parsed.name}_test${parsed.ext}`),
    join(parsed.dir, "__tests__", `${parsed.name}.test${parsed.ext}`),
    join(
      projectRoot,
      "tests",
      relative(projectRoot, parsed.dir),
      `${parsed.name}_test.py`,
    ),
  ];

  for (const candidate of candidates) {
    if (await exists(candidate)) {
      return true;
    }
  }

  return false;
}

async function main() {
  const projectRoot = repositoryRoot(process.cwd());
  if (!projectRoot) {
    return;
  }

  const configPath = join(projectRoot, ".codex-harness", "config.json");
  if (!(await exists(configPath))) {
    return;
  }

  const config = JSON.parse(await readFile(configPath, "utf8"));
  const roots = config?.coverage?.roots ?? [];
  const extensions = new Set(config?.coverage?.extensions ?? []);
  const missingTests = [];

  for (const file of changedFiles(projectRoot)) {
    const normalized = file.split(sep).join("/");
    const isCoveredRoot = roots.some(
      (root) => normalized === root || normalized.startsWith(`${root}/`),
    );
    if (
      !isCoveredRoot ||
      !extensions.has(extname(normalized)) ||
      isTestFile(normalized) ||
      /(?:config|\.config|\.d)\.[^.]+$/.test(normalized)
    ) {
      continue;
    }

    if (!(await hasAdjacentTest(projectRoot, normalized))) {
      missingTests.push(normalized);
    }
  }

  const testMessage = missingTests.length
    ? ` Potentially untested logic: ${missingTests.slice(0, 5).join(", ")}${
        missingTests.length > 5 ? "…" : ""
      }. Add a regression/unit test when the file contains behavior.`
    : "";
  const message =
    "Codex Project Harness: before completion run " +
    "`node .codex-harness/scripts/verify-project.mjs`." +
    testMessage;

  process.stdout.write(`${JSON.stringify({ systemMessage: message })}\n`);
}

main().catch((error) => {
  process.stdout.write(
    `${JSON.stringify({
      systemMessage: `Codex Project Harness check could not run: ${error.message}`,
    })}\n`,
  );
});
