import { withWorkflow } from "workflow/next";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  // No Content-Security-Policy yet, deliberately: the buy flow polls a public
  // Base Sepolia RPC client-side (BuyTickets.tsx's waitForTransactionReceipt),
  // and getting connect-src wrong would silently break ticket payment
  // confirmation rather than fail loudly - needs a live browser test of the
  // full buy-and-pay flow before shipping one, not just a code review.
  async headers() {
    return [
      {
        // Excludes /tg - the Telegram Mini App - which must be frameable by
        // Telegram itself (see the next rule) and would otherwise be blocked
        // from loading at all inside Telegram Web's iframe.
        source: "/((?!tg).*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
      {
        // Telegram Web renders Mini Apps inside an <iframe>; a blanket
        // X-Frame-Options: DENY (the rule above) would silently block the
        // app from ever loading there. CSP's frame-ancestors is the modern,
        // precise replacement - scoped to Telegram's own origins only, so
        // this path still can't be framed by anything else.
        source: "/tg/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
          {
            key: "Content-Security-Policy",
            value: "frame-ancestors 'self' https://web.telegram.org https://oauth.telegram.org;",
          },
        ],
      },
    ];
  },
};

export default withWorkflow(nextConfig);
