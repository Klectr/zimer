# Zandbox

A dev-only component lab for Bun + HTMX projects: a Storybook-shaped sandbox
with no rendering library and no build step. Components are server-template
functions and Web Components; Zandbox renders them in every state against the
project's own stylesheets, with fictional data only.

Zandbox is developed inside the Zimer repo under this `.zandbox/` directory,
deliberately self-contained so the directory can be lifted into its own repo
unchanged. The engine imports nothing from the host project.

## The contract

A project adopts Zandbox with one file at its root, `zandbox.config.ts`,
default-exporting a `ZandboxConfig` (see `.zandbox/config.ts`):

- `stories` — the registry: an array of `Story` objects
  (`{ id, group, title, render }`, see `.zandbox/story.ts`). Stories live in
  their own files, separate from the components they showcase — Storybook's
  model: a project keeps them in a `stories/` directory as
  `<name>.stories.ts` files that import the components; component files
  contain no story code and never import Zandbox. The config gathers the
  story arrays. Story ids are lowercase letters, digits, and dashes, and
  must be unique — the server throws at startup otherwise.
- `assets` — a map of URL path → project-relative file path. These are the
  project's own static files (its stylesheet, its elements script), served
  as-is so stories render with production styling.
- `designMd` — optional path to the project's DESIGN.md. When set, Zandbox
  generates a Tokens story from the file's YAML color tokens
  (`.zandbox/design-tokens.ts`); unsupported values throw instead of
  rendering wrong.
- `name`, `port`, `htmxUrl` — optional. Port resolution: `ZANDBOX_PORT`
  env, then config, then 8935. HTMX defaults to the CDN build the host app
  uses.

## Running

From the project root:

```
bun run .zandbox/server.ts
```

The server binds 127.0.0.1 only. `/` renders every story; `/canvas/<id>`
renders one story bare for isolated viewing; a story that throws renders an
error cell on the index instead of taking the lab down.

## Rules for stories

- Fictional demo data only — never real client data, never a database.
- A story must render the component as the app renders it (same classes,
  same markup). If a state cannot be rendered truthfully (for example a
  style variant the stylesheet does not define), the component says so —
  by throwing — rather than showing a plausible fake.
