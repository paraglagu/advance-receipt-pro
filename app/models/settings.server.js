import prisma from "../db.server";
import { formatReceiptNo } from "../utils/domain";

export { formatReceiptNo };

export async function getSettings(shop) {
  let settings = await prisma.advanceSettings.findUnique({ where: { shop } });
  if (!settings) {
    settings = await prisma.advanceSettings.create({ data: { shop } });
  }
  return settings;
}

export async function saveSettings(shop, data) {
  return prisma.advanceSettings.upsert({
    where: { shop },
    update: data,
    create: { shop, ...data },
  });
}

/**
 * Claims the next number in the series. The increment is a single atomic
 * UPDATE, so two cashiers hitting Save at the same moment cannot be handed
 * the same receipt number.
 */
export async function claimNextReceiptNo(shop) {
  await getSettings(shop); // ensure the row exists
  const updated = await prisma.advanceSettings.update({
    where: { shop },
    data: { nextReceiptNo: { increment: 1 } },
  });
  // update() returns the post-increment row, so the number we claimed is one back.
  return formatReceiptNo(updated, updated.nextReceiptNo - 1);
}

/** Preview of the number the next receipt will get, without consuming it. */
export async function peekNextReceiptNo(shop) {
  const settings = await getSettings(shop);
  return formatReceiptNo(settings, settings.nextReceiptNo);
}

/**
 * The POS custom-payment names that mean "paid out of an advance".
 * Compared case-insensitively and whitespace-insensitively, because what a
 * cashier types into POS never quite matches what's in Settings.
 */
export function tenderNameList(settings) {
  return String(settings.tenderNames || "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

export function isAdvanceTender(settings, gatewayName) {
  if (!gatewayName) return false;
  const needle = String(gatewayName).trim().toLowerCase();
  return tenderNameList(settings).some(
    (name) => needle === name || needle.includes(name),
  );
}
