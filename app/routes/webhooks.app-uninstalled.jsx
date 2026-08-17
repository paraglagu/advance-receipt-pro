import { authenticate } from "../shopify.server";
import prisma from "../db.server";

export const action = async ({ request }) => {
  const { shop, session, topic } = await authenticate.webhook(request);

  // Sessions go; receipts and ledger stay. If the merchant reinstalls, their
  // customers' outstanding advances must still be there.
  if (session) {
    try {
      await prisma.session.deleteMany({ where: { shop } });
    } catch (e) {
      console.error(`[webhook ${topic}] session cleanup failed for ${shop}:`, e.message);
    }
  }

  return new Response("OK", { status: 200 });
};
