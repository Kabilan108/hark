import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { completionFor } from "../src/completions.mjs";
import { execute } from "../src/cli.mjs";

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));

test("skill commands read the generated skill without credentials", async () => {
  const main = await execute(["skill"], {});
  const services = await execute(["skill", "services"], {});
  const list = await execute(["skill", "list"], {});

  assert.match(main.body.output, /^---\nname: hark/m);
  assert.match(services.body.output, /^# Hark integration webhooks/m);
  assert.equal(list.body.output, "services");
  await assert.rejects(execute(["skill", "missing"], {}), /Unknown skill reference/);
});

test("generated skill assets match the canonical skill", async () => {
  const pairs = [
    ["../../../skills/hark/SKILL.md", "../generated/skill/SKILL.md"],
    ["../../../skills/hark/references/services.md", "../generated/skill/references/services.md"],
  ];
  for (const [canonical, generated] of pairs) {
    assert.equal(
      await readFile(new URL(canonical, import.meta.url), "utf8"),
      await readFile(new URL(generated, import.meta.url), "utf8"),
    );
  }
});

test("packed CLI prints its installed skill outside the checkout", async () => {
  const directory = await mkdtemp(join(tmpdir(), "harkctl-pack-"));
  try {
    const packed = spawnSync(
      "npm",
      ["pack", "--ignore-scripts", "--json", "--pack-destination", directory],
      { cwd: packageRoot, encoding: "utf8" },
    );
    assert.equal(packed.status, 0, packed.stderr);
    const [{ filename }] = JSON.parse(packed.stdout);
    const extracted = join(directory, "package");
    const unpacked = spawnSync("tar", ["-xzf", join(directory, filename), "-C", directory], {
      encoding: "utf8",
    });
    assert.equal(unpacked.status, 0, unpacked.stderr);
    await symlink(join(packageRoot, "node_modules"), join(extracted, "node_modules"), "dir");

    const env = { ...process.env, HARK_CONFIG: join(directory, "missing-config.json") };
    delete env.HARK_TOKEN;
    const invoked = spawnSync(process.execPath, [join(extracted, "bin/harkctl.mjs"), "skill"], {
      cwd: directory,
      env,
      encoding: "utf8",
    });
    assert.equal(invoked.status, 0, invoked.stderr);
    assert.match(invoked.stdout, /^---\nname: hark/m);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("completion scripts include commands, flags, and enums without credentials", async () => {
  for (const shell of ["bash", "zsh", "fish"]) {
    const result = await execute(["completions", shell], {});
    assert.equal(result.body.output, completionFor(shell));
    assert.match(result.body.output, /projects/);
    assert.match(result.body.output, /--kind|\-l kind/);
    assert.match(result.body.output, /event notification interaction activity/);
    assert.match(result.body.output, /exclude include only/);
  }
  await assert.rejects(execute(["completions", "powershell"], {}), /bash, zsh, or fish/);
});

test("generated completion scripts pass their shell syntax checks", () => {
  for (const [shell, args] of [
    [process.env.HARKCTL_TEST_BASH ?? "bash", ["-n"]],
    ["zsh", ["-n"]],
    ["fish", ["-n"]],
  ]) {
    const completionShell = shell.includes("bash") ? "bash" : shell;
    const checked = spawnSync(shell, args, { input: completionFor(completionShell), encoding: "utf8" });
    assert.equal(checked.status, 0, `${completionShell}: ${checked.stderr}`);
  }
});

test("completion generators use command-specific flags and style values", () => {
  const bash = completionFor("bash");
  const update = [...bash.matchAll(/'activity update'\) candidates="([^"]+)"/g)].find(
    (match) => match[1].startsWith("--"),
  );
  assert.ok(update);
  assert.match(update[1], /--if-sequence/);
  assert.doesNotMatch(update[1], /--key/);
  assert.match(bash, /'notify ask'\) candidates="approval shell verdict signal"/);
  assert.match(bash, /'activity start'\|'activity update'\) candidates="standard ring hero terminal steps"/);
  assert.match(bash, /\*\) candidates=""/);

  const zsh = completionFor("zsh");
  assert.ok(zsh.indexOf('[[ "${PREFIX}" == --* ]]') < zsh.indexOf("(( CURRENT == 3 ))"));
  assert.match(zsh, /'notify ask'\) _values 'style' approval shell verdict signal/);

  const fish = completionFor("fish");
  assert.match(fish, /__fish_prev_arg_in --style; and __fish_seen_subcommand_from ask.*approval shell verdict signal/);
  assert.match(fish, /__fish_prev_arg_in --style; and __fish_seen_subcommand_from start update.*standard ring hero terminal steps/);
});

test("bash completion returns flags and context-specific style values", async () => {
  const directory = await mkdtemp(join(tmpdir(), "harkctl-completion-"));
  const path = join(directory, "harkctl.bash");
  try {
    await writeFile(path, completionFor("bash"));
    const commands = [
      'source "$1"',
      "COMP_WORDS=(harkctl activity update act_1 --); COMP_CWORD=4; _harkctl",
      "printf 'flags=%s\\n' \"${COMPREPLY[*]}\"",
      "COMP_WORDS=(harkctl activity update act_1 --style ''); COMP_CWORD=5; _harkctl",
      "printf 'task_styles=%s\\n' \"${COMPREPLY[*]}\"",
      "COMP_WORDS=(harkctl notify ask Prompt --style ''); COMP_CWORD=5; _harkctl",
      "printf 'ask_styles=%s\\n' \"${COMPREPLY[*]}\"",
      "COMP_WORDS=(harkctl auth status --); COMP_CWORD=3; _harkctl",
      "printf 'status_flags=%s\\n' \"${COMPREPLY[*]}\"",
    ].join("\n");
    const completed = spawnSync(
      process.env.HARKCTL_TEST_BASH ?? "bash",
      ["-c", commands, "bash", path],
      { encoding: "utf8" },
    );
    assert.equal(completed.status, 0, completed.stderr);
    assert.match(`${completed.stdout}\nstderr=${completed.stderr}`, /flags=.*--if-sequence/);
    assert.doesNotMatch(completed.stdout, /flags=.*--key/);
    assert.match(completed.stdout, /task_styles=standard ring hero terminal steps/);
    assert.match(completed.stdout, /ask_styles=approval shell verdict signal/);
    assert.match(completed.stdout, /status_flags=--help/);
    assert.doesNotMatch(completed.stdout, /status_flags=.*--title/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
