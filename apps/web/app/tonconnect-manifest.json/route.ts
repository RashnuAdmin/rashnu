export async function GET() {
  const domain = process.env.TG_MINIAPP_DOMAIN;
  if (!domain) {
    throw new Error("Missing required environment variable: TG_MINIAPP_DOMAIN");
  }

  const manifest = {
    url: `https://${domain}`,
    name: "Rashnu",
    iconUrl: `https://${domain}/tg-icon-180.png`,
    termsOfUseUrl: `https://${domain}/legal`,
  };

  return Response.json(manifest);
}
