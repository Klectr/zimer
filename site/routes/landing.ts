/** #731: hosted landing page router — kept in its own router like /pricing
 *  (#729) so parallel web.ts work doesn't conflict. Mounted in server.ts
 *  before handlePricing and handleWeb. Returns null when the request isn't
 *  "hosted mode + logged-out visitor + GET /": self-host mode and authed
 *  hosted users fall straight through, so / keeps its current behavior
 *  for both (self-host: 302 to /login; authed: the app). */

export interface LandingDeps {
  hosted: boolean;
  /** Logged-in visitor in hosted mode (session), self-host cookie token. */
  visitorAuthed: (req: Request) => boolean;
  /** Same absolute-origin helper invoice share links use (#301) — unfurlers
   *  ignore relative og:image/twitter:image URLs. #865 */
  shareOrigin: (req: Request) => string;
  landingPage: (origin: string) => string;
  html: (body: string, status?: number, headers?: HeadersInit) => Response;
}

export function createLandingRouter(deps: LandingDeps) {
  const { hosted, visitorAuthed, landingPage, html } = deps;

  async function handleLanding(
    req: Request,
    url: URL,
    path: string,
    method: string
  ): Promise<Response | null> {
    if (path !== "/" || method !== "GET") return null;
    if (!hosted) return null;
    if (visitorAuthed(req)) return null;
    return html(landingPage(deps.shareOrigin(req))); /* #865 */
  }

  return { handleLanding };
}
