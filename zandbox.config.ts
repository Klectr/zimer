import type { ZandboxConfig } from "./zandbox/config";
import { buttonStories } from "./stories/button.stories";

const config: ZandboxConfig = {
  name: "Zandbox",
  stories: [...buttonStories],
  assets: {
    "/static/style.css": "site/static/style.css",
  },
  designMd: "DESIGN.md",
};

export default config;
