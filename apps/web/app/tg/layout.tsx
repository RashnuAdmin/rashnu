"use client";

import { TonConnectUIProvider } from "@tonconnect/ui-react";
import type { ReactNode } from "react";

export default function TgLayout({ children }: { children: ReactNode }) {
  const domain = process.env.NEXT_PUBLIC_TG_MINIAPP_DOMAIN;

  return (
    <TonConnectUIProvider
      manifestUrl={`https://${domain}/tonconnect-manifest.json`}
      actionsConfiguration={{
        // Required specifically for the Telegram Mini App context - without
        // it, an external wallet app's approval flow has nowhere documented
        // to send the user back to, and they're left stranded outside
        // Telegram after approving the connection.
        twaReturnUrl: `https://t.me/${process.env.NEXT_PUBLIC_TG_BOT_USERNAME}` as `${string}://${string}`,
      }}
    >
      {children}
    </TonConnectUIProvider>
  );
}
