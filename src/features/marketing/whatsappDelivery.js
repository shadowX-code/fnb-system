export function normalizeMalaysianPhone(value) {
  if (
    typeof value !== "string" ||
    !/^\+?[0-9 ()-]{8,30}$/.test(value) ||
    (value.startsWith("+") && !value.startsWith("+60"))
  )
    throw new Error("Enter a valid Malaysian phone number.");
  let n = value.replace(/\D/g, "");
  if (n.startsWith("0060")) n = n.slice(2);
  else if (n.startsWith("0")) n = `60${n.slice(1)}`;
  if (!/^60[1-9][0-9]{7,9}$/.test(n))
    throw new Error("Enter a valid +60 phone number.");
  return `+${n}`;
}
export const whatsappDeliveryAdapters = Object.freeze({
  whatsapp_manual: Object.freeze({
    id: "whatsapp_manual",
    verifiedDelivery: false,
    automatedSending: false,
    openLink(receipt) {
      if (receipt.state !== "opened")
        throw new Error("Open an eligible recipient first.");
      const phone = normalizeMalaysianPhone(receipt.phone);
      if (typeof receipt.caption !== "string" || !receipt.caption)
        throw new Error("Approved caption unavailable.");
      return `https://wa.me/${phone.slice(1)}?text=${encodeURIComponent(receipt.caption)}`;
    },
  }),
  whatsapp_cloud: Object.freeze({
    id: "whatsapp_cloud",
    available: false,
    verifiedDelivery: false,
    automatedSending: false,
    requiredCapabilities: [
      "approved_templates",
      "valid_opt_in",
      "official_credentials",
      "webhook_receipts",
      "billing_authorization",
    ],
  }),
});
