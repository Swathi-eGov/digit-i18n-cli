#!/usr/bin/env node
// Runs automatically whenever digit-i18n-cli is installed as a real
// dependency (npm/yarn's postinstall lifecycle) — NOT via `yarn link`,
// which doesn't trigger lifecycle scripts at all, so this stays completely
// inert for everything tested so far.
//
// INIT_CWD recovers the directory the developer actually ran install from —
// but in an npm/yarn WORKSPACE, install is normally run once from the
// workspace root, not from inside whichever package actually depends on us.
// That makes INIT_CWD the wrong thing to scope a hook to: it tells you where
// the install command was invoked, not which package declared the
// dependency. Instead, we scan the repo for whichever package.json file(s)
// actually list "digit-i18n-cli" and scope a hook to each of those
// directories — correct regardless of where install was run from.
//
// Must NEVER fail the consuming project's install, no matter what happens
// here — automatic hook setup is a nice-to-have, not a requirement for the
// dependency to be usable. Any problem here just means a developer runs
// "digit-i18n install-hooks" manually afterward, same as today.
import fs from "fs";
import path from "path";
import { glob } from "glob";
import { installHooksCommand, findGitRoot } from "../src/commands/installHooks.js";

const initCwd = process.env.INIT_CWD || process.cwd();

async function findDeclaringPackageDirs(gitRoot) {
  const pkgJsonPaths = await glob("**/package.json", {
    cwd: gitRoot,
    ignore: ["**/node_modules/**"],
    absolute: true,
    nodir: true,
  });

  const dirs = [];
  for (const pkgPath of pkgJsonPaths) {
    let pkg;
    try {
      pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
    } catch {
      continue; // unreadable/invalid package.json — not fatal, just skip it
    }
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    if (deps["digit-i18n-cli"]) {
      dirs.push(path.dirname(pkgPath));
    }
  }
  return dirs;
}

async function run() {
  const gitRoot = findGitRoot(initCwd);

  let targets = [];
  if (gitRoot) {
    try {
      targets = await findDeclaringPackageDirs(gitRoot);
    } catch (err) {
      console.warn(`digit-i18n: could not scan for declaring package.json files (${err.message}).`);
    }
  }

  // Couldn't find a git root, or no package.json declared us (shouldn't
  // normally happen — we're being installed as someone's dependency) — fall
  // back to the old best-effort behavior rather than doing nothing.
  if (targets.length === 0) {
    targets = [initCwd];
  }

  for (const dir of targets) {
    try {
      installHooksCommand({ cwd: dir });
    } catch (err) {
      console.warn(`digit-i18n: automatic hook setup skipped for ${dir} (${err.message}).`);
      console.warn('Run "digit-i18n install-hooks" manually from that module folder if you want this.');
    }
  }
}

await run();

// installHooksCommand sets process.exitCode on its own "refused" paths
// (not a git repo, scoped to git root, etc.) — none of that should ever
// fail someone else's install.
process.exitCode = 0;
