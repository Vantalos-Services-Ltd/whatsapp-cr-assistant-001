/**
 * Shared utility for consistent person display formatting across the portal.
 * Format: "[First Name] [Last Name] - [Trade]" as primary, phone only on hover/click.
 */

export type PersonDisplayInput = {
  candidate?: { name?: string | null; desiredRole?: string | null; phone?: string | null };
  contact?: { name?: string | null; phone?: string | null };
  phone?: string | null;
};

/**
 * Format phone number for display:
 * - Strip "whatsapp:" prefix
 * - Normalize spaces
 * - Keep +44 etc
 */
export function formatPhone(phone: string): string {
  if (!phone) return "";
  
  // Remove whatsapp: prefix if present
  let cleanPhone = phone.replace(/^whatsapp:/i, "");
  
  // Remove other common prefixes like tel:, sms:, callto:, etc.
  cleanPhone = cleanPhone.replace(/^(tel|sms|callto):/i, "");
  
  // Normalize spaces (remove extra spaces, trim)
  cleanPhone = cleanPhone.trim().replace(/\s+/g, " ");
  
  return cleanPhone;
}

/**
 * Get primary display name for a person.
 * 
 * Rules:
 * 1) Prefer Candidate.name if exists
 * 2) Else prefer Contact.name if exists
 * 3) Else fallback to formatted phone
 * 
 * Trade:
 * - Use Candidate.desiredRole if present, else omit trade suffix
 * 
 * Return:
 * - If name exists + trade exists -> "Name - Trade"
 * - If name exists only -> "Name"
 * - Else -> formatted phone
 */
export function getPrimaryDisplay(input: PersonDisplayInput): string {
  // Extract name (prefer candidate, then contact)
  let name: string | null = null;
  if (input.candidate?.name) {
    name = input.candidate.name.trim();
  } else if (input.contact?.name) {
    name = input.contact.name.trim();
  }
  
  // Extract trade (only from candidate)
  const trade = input.candidate?.desiredRole?.trim() || null;
  
  // Extract phone (prefer candidate, then contact, then direct)
  const phone = input.candidate?.phone || input.contact?.phone || input.phone || null;
  
  // Build display
  if (name) {
    // If name exists + desiredRole exists -> "Name - DesiredRole"
    // If name exists only -> "Name"
    if (trade) {
      return `${name} - ${trade}`;
    }
    return name;
  }
  
  // If name missing: show formatted phone (for candidates)
  // For contacts without name, show "Contact" placeholder
  if (phone) {
    // If this is a candidate (has desiredRole or candidate data), show formatted phone
    if (input.candidate || trade) {
      return formatPhone(phone);
    }
    // For contacts without name, use placeholder
    return "Contact";
  }
  
  // Last resort. Never render a bare dash where a person's name belongs — it
  // reads as a rendering fault and gives the operator nothing to act on.
  return "Unknown contact";
}

/**
 * Get secondary phone display (for hover/click).
 * Returns formatted phone if exists, else null.
 */
export function getSecondaryPhone(input: PersonDisplayInput): string | null {
  const phone = input.candidate?.phone || input.contact?.phone || input.phone || null;
  
  if (!phone) {
    return null;
  }
  
  const formatted = formatPhone(phone);
  return formatted || null;
}

