/** #729: public pricing page route — kept in its own router so the
 *  parallel #733 work on web.ts doesn't conflict. Mounted in server.ts
 *  before handleWeb. Returns null when the path isn't /pricing.
 *
 *  No auth, renders in BOTH modes: hosted shows the "Start free trial"
 *  CTA (/signup), self-host shows the free-forever note. */

export interface PricingDeps {
  hosted: boolean;
  pricingPage: () => string;
  html: (body: string, status?: number, headers?: HeadersInit) => Response;
}

export function createPricingRouter(deps: PricingDeps) {
  const { pricingPage, html } = deps;

  async function handlePricing(
    req: Request,
    url: URL,
    path: string,
    method: string
  ): Promise<Response | null> {
    if (path !== "/pricing") return null;
    if (method !== "GET") return null;
    return html(pricingPage());
  }

  return { handlePricing };
}
