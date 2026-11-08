import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ENGINE_DIR = import.meta.dir;
const ROOT = process.cwd();
const TARGET_ENGINE = join(ROOT, ".zandbox");

const CONFIG = `import type { ZandboxConfig } from "./.zandbox/config";
import { exampleStories } from "./stories/example.stories";

const config: ZandboxConfig = {
  name: "Zandbox",
  stories: [...exampleStories],
  assets: {},
};

export default config;
`;

const EXAMPLE_STORY = `import type { Story } from "../.zandbox/story";

export const exampleStories: Story[] = [
  {
    id: "example-welcome",
    group: "Example",
    title: "Welcome — replace with a real component",
    render: () =>
      \`<p style="max-width:52ch;line-height:1.6">This story proves your Zandbox works.
      Delete it and add a <b>.stories.ts</b> file per component: import the component,
      export a Story array, and register it in zandbox.config.ts.</p>\`,
  },
];
`;

function fail(message: string): never {
  console.error(`zandbox: ${message}`);
  process.exit(1);
}

function init(): void {
  const configPath = join(ROOT, "zandbox.config.ts");
  if (existsSync(configPath)) {
    fail("zandbox.config.ts already exists — this project is already initialized. Nothing changed.");
  }

  const copied: string[] = [];
  if (ENGINE_DIR !== TARGET_ENGINE) {
    if (existsSync(TARGET_ENGINE)) {
      fail(".zandbox/ already exists but there is no zandbox.config.ts. Nothing changed — inspect the folder, then either delete it and re-run init, or write the config by hand.");
    }
    cpSync(ENGINE_DIR, TARGET_ENGINE, { recursive: true });
    copied.push(".zandbox/ (engine)");
  }

  mkdirSync(join(ROOT, "stories"), { recursive: true });
  const storyPath = join(ROOT, "stories", "example.stories.ts");
  if (!existsSync(storyPath)) writeFileSync(storyPath, EXAMPLE_STORY);
  writeFileSync(configPath, CONFIG);
  copied.push("stories/example.stories.ts", "zandbox.config.ts");

  const pkgPath = join(ROOT, "package.json");
  if (existsSync(pkgPath)) {
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as { scripts?: Record<string, string> };
    pkg.scripts ??= {};
    pkg.scripts.zandbox ??= "bun run ./.zandbox/server.ts";
    writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");
    copied.push("package.json script (zandbox)");
  }

  console.log(`Zandbox initialized: ${copied.join(", ")}`);
  console.log("Next: bun run zandbox — then map your stylesheet in zandbox.config.ts (assets) and point designMd at your DESIGN.md if you have one.");
}

const command = process.argv[2];
if (command === "init") {
  init();
} else {
  fail(command ? `unknown command "${command}" (only "init" exists)` : 'usage: bun run .zandbox/cli.ts init');
}
