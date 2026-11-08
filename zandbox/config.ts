import type { Story } from "./story";

export interface ZandboxConfig {
  name?: string;
  port?: number;
  stories: Story[];
  assets?: Record<string, string>;
  designMd?: string;
  htmxUrl?: string;
}
