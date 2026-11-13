"use client";

import dynamic from "next/dynamic";

// @telegram-apps/sdk-react and @tonconnect/ui-react both assume a browser
// (window/navigator) unconditionally - loading the real component eagerly
// breaks Next.js's static-shell prerender pass ("ReferenceError: window is
// not defined") even though this whole route is already client-only. `ssr:
// false` is the documented way to opt a component out of that prerender pass
// entirely, deferring it to the client.
const TelegramMiniAppClient = dynamic(() => import("./TelegramMiniAppClient"), {
  ssr: false,
  loading: () => (
    <main className="flex flex-1 flex-col items-center gap-6 p-6">
      <p className="text-sm text-gray-600">Loading...</p>
    </main>
  ),
});

export default function TelegramMiniAppPage() {
  return <TelegramMiniAppClient />;
}
