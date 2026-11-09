import type { ZandboxConfig } from "./.zandbox/config";
import { buttonStories } from "./stories/button.stories";
import { cardStories } from "./stories/card.stories";
import { fieldStories } from "./stories/field.stories";
import { statusChipStories } from "./stories/status-chip.stories";
import { tokenStories } from "./stories/tokens.stories";
import { iconButtonStories } from "./stories/icon-button.stories";
import { shellStories } from "./stories/shell.stories";
import { dataStories } from "./stories/data.stories";
import { calendarStories } from "./stories/calendar.stories";
import { feedbackStories } from "./stories/feedback.stories";

const config: ZandboxConfig = {
  name: "Zandbox",
  stories: [
    ...buttonStories,
    ...statusChipStories,
    ...fieldStories,
    ...cardStories,
    ...iconButtonStories,
    ...shellStories,
    ...dataStories,
    ...calendarStories,
    ...feedbackStories,
    ...tokenStories,
  ],
  assets: {
    "/static/style.css": "site/static/style.css",
  },
  designMd: "DESIGN.md",
};

export default config;
