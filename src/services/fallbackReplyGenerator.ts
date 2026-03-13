/**
 * Generate a fallback UK recruiter style reply message for approval scenarios.
 * 
 * This is a deterministic helper that creates safe, professional messages
 * without requiring AI. It tailors the message slightly if location or trade
 * hints are detected in the inbound text.
 * 
 * @param intent - The classified intent of the inbound message
 * @param inboundText - The original message text from the candidate
 * @param candidateName - Optional candidate name for personalization
 * @param desiredRole - Optional desired role/trade from candidate profile
 * @param playbook - Optional playbook for greeting and signature style
 * @returns A short UK recruiter style message
 */
export function getFallbackReplyForApproval({
  intent,
  inboundText,
  candidateName,
  desiredRole,
  playbook,
}: {
  intent: string;
  inboundText: string;
  candidateName?: string | null;
  desiredRole?: string | null;
  playbook?: import("../shared/playbook.js").AgencyPlaybook;
}): string {
  const text = inboundText.toLowerCase().trim();
  
  // Common UK location patterns (cities, regions, postcodes)
  const locationPatterns = [
    /\b(london|manchester|birmingham|leeds|glasgow|edinburgh|liverpool|bristol|cardiff|belfast)\b/,
    /\b(kent|essex|surrey|yorkshire|lancashire|devon|cornwall|scotland|wales|northern ireland)\b/,
    /\b([a-z]{1,2}\d{1,2}\s?\d[a-z]{2})\b/, // UK postcode pattern (e.g., "SW1A 1AA", "M1 1AA")
    /\b(north|south|east|west)\s+[a-z]+\b/, // Directional regions
    /\b(based in|from|in|near|around)\s+[a-z]+\b/, // Location phrases
  ];
  
  // Common trade/role patterns
  const tradePatterns = [
    /\b(bricklayer|brick layer|brickie)\b/,
    /\b(carpenter|chippy|joiner)\b/,
    /\b(electrician|sparky)\b/,
    /\b(plumber|plumbing)\b/,
    /\b(plasterer|plastering)\b/,
    /\b(roofer|roofing)\b/,
    /\b(painter|decorator|painting)\b/,
    /\b(groundworker|ground worker)\b/,
    /\b(operator|machine operator|plant operator)\b/,
    /\b(driver|hgv|hgv driver|class 1|class 2)\b/,
    /\b(warehouse|warehouse operative|picker|packer)\b/,
    /\b(forklift|fork lift|flt)\b/,
    /\b(labourer|labour|general operative)\b/,
    /\b(trade|tradesman|tradesperson)\b/,
  ];
  
  const hasLocationHint = locationPatterns.some(pattern => pattern.test(text));
  const hasTradeHint = tradePatterns.some(pattern => pattern.test(text)) || 
                       (desiredRole && text.includes(desiredRole.toLowerCase()));
  
  // Use desiredRole if available and not already mentioned in text
  const tradeMentioned = desiredRole && text.includes(desiredRole.toLowerCase());
  const relevantTrade = tradeMentioned ? desiredRole : desiredRole;
  
  // Build personalized greeting based on playbook or default
  let greeting = "";
  if (playbook) {
    // Use playbook greeting style
    if (playbook.greetingStyle === "NONE") {
      greeting = "";
    } else if (playbook.greetingStyle === "SHORT") {
      greeting = candidateName ? `Hi ${candidateName.split(' ')[0]}, ` : "Hi, ";
    } else {
      // NORMAL
      greeting = candidateName ? `Hello ${candidateName.split(' ')[0]}, ` : "Hello, ";
    }
  } else {
    // Default greeting style (SHORT)
    greeting = candidateName ? `Hi ${candidateName.split(' ')[0]}, ` : "Hi, ";
  }
  
  // Tailor message based on intent and detected hints
  switch (intent) {
    case "LOOKING_FOR_WORK":
      if (hasLocationHint && hasTradeHint) {
        return `${greeting}Got you. Just to confirm, what trade are you looking for and what area are you based in?`;
      } else if (hasLocationHint) {
        return `${greeting}Got you. Just to confirm, what trade are you looking for and what area are you based in?`;
      } else if (hasTradeHint || relevantTrade) {
        return `${greeting}Got you. Just to confirm, what area are you based in and when are you available?`;
      } else {
        return `${greeting}Got you. Just to confirm, what trade are you looking for and what area are you based in?`;
      }
    
    case "AVAILABILITY_UPDATE":
      if (hasLocationHint && hasTradeHint) {
        return `${greeting}Noted, cheers. Just to confirm, what trade are you looking for and what area are you based in?`;
      } else if (hasLocationHint) {
        return `${greeting}Noted, cheers. Just to confirm, what trade are you looking for?`;
      } else if (hasTradeHint || relevantTrade) {
        return `${greeting}Noted, cheers. Just to confirm, what area are you based in?`;
      } else {
        return `${greeting}Noted, cheers. Just to confirm, what trade are you looking for and what area are you based in?`;
      }
    
    case "JOB_QUERY":
      if (hasLocationHint && hasTradeHint) {
        return `${greeting}Got it. Just to confirm, what trade are you looking for and what area are you based in?`;
      } else if (hasLocationHint) {
        return `${greeting}Got it. Just to confirm, what trade are you looking for?`;
      } else if (hasTradeHint || relevantTrade) {
        return `${greeting}Got it. Just to confirm, what area are you based in?`;
      } else {
        return `${greeting}Got it. Just to confirm, what trade are you looking for and what area are you based in?`;
      }
    
    case "FOLLOW_UP":
      return `${greeting}Got it. Just checking this and I'll come back to you.`;
    
    case "UNKNOWN":
    default:
      if (hasLocationHint && hasTradeHint) {
        return `${greeting}Got you. Just to confirm, what trade are you looking for and what area are you based in?`;
      } else if (hasLocationHint) {
        return `${greeting}Got you. Just to confirm, what trade are you looking for?`;
      } else if (hasTradeHint || relevantTrade) {
        return `${greeting}Got you. Just to confirm, what area are you based in?`;
      } else {
        return `${greeting}Got you. Just to confirm, what trade are you looking for and what area are you based in?`;
      }
  }
}

