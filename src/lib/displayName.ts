/**
 * Server-side utility for building consistent display names
 * Matches frontend lib/displayName.ts logic
 */

/**
 * Format phone number by removing whatsapp: prefix and normalizing
 */
export function formatPhone(phone: string | null | undefined): string {
  if (!phone) return "";
  let cleanPhone = phone.replace(/^whatsapp:/i, "");
  cleanPhone = cleanPhone.replace(/^(tel|sms|callto):/i, "");
  return cleanPhone.trim();
}

/**
 * Build display name from candidate or contact data
 * Priority: Candidate.name + desiredRole > Contact.name > formatted phone
 */
export function buildDisplayName(input: {
  candidate?: { name?: string | null; desiredRole?: string | null } | null;
  contact?: { name?: string | null } | null;
  phone?: string | null;
}): { displayName: string; trade: string | null; phone: string } {
  const { candidate, contact, phone: rawPhone } = input;
  
  // Format phone
  const phone = formatPhone(rawPhone || candidate?.phone || contact?.phone || "");
  
  // Priority 1: Candidate name + desiredRole
  if (candidate?.name) {
    const trade = candidate.desiredRole || null;
    const displayName = trade ? `${candidate.name} - ${trade}` : candidate.name;
    return { displayName, trade, phone };
  }
  
  // Priority 2: Contact name
  if (contact?.name) {
    return { displayName: contact.name, trade: null, phone };
  }
  
  // Priority 3: Formatted phone fallback
  return { displayName: phone || "—", trade: null, phone: phone || "" };
}



