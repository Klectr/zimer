import type { ZandboxConfig } from "./zandbox/config";
import { buttonStories } from "./site/ui/button";
import { cardStories } from "./site/ui/card";
import { fieldStories } from "./site/ui/field";
import { statusChipStories } from "./site/ui/status-chip";

const config: ZandboxConfig = {
  name: "Zandbox",
  stories: [...buttonStories, ...statusChipStories, ...fieldStories, ...cardStories],
  assets: {
    "/static/style.css": "site/static/style.css",
  },
  designMd: "DESIGN.md",
};

export default config;
