/**
 * Automatically determines the API base URL based on where the frontend is loaded from.
 * 
 * - Returns "http://localhost:3001" when frontend is on localhost
 * - Returns ngrok backend URL when frontend is on ngrok domain (from env var or constructed)
 * - Falls back to environment variable if set
 * - Handles SSR safely (returns empty string if window is undefined)
 * 
 * This allows the app to work on both localhost and ngrok without changing env files.
 * For ngrok, the backend URL should be set in NEXT_PUBLIC_API_URL, but we'll try to
 * construct it from the frontend URL as a fallback.
 */
export function getApiBaseUrl(): string {
  // SSR safety check
  if (typeof window === "undefined") {
    // During SSR, return env var if available, otherwise empty string
    return process.env.NEXT_PUBLIC_API_URL || "";
  }

  const hostname = window.location.hostname;
  const protocol = window.location.protocol;

  // Localhost detection - return localhost backend
  if (hostname === "localhost" || hostname === "127.0.0.1") {
    return "http://localhost:3001";
  }

  // Ngrok domain detection
  if (hostname.endsWith(".ngrok-free.app") || hostname.endsWith(".ngrok.app")) {
    // When frontend is on ngrok, check for explicit backend URL in env var first
    if (process.env.NEXT_PUBLIC_API_URL) {
      return process.env.NEXT_PUBLIC_API_URL;
    }
    
    // If env var not set, try to construct backend URL from frontend URL
    // This assumes the backend might be on the same ngrok tunnel (unlikely but possible)
    // or the user will set NEXT_PUBLIC_API_URL for the actual backend ngrok URL
    // 
    // Note: Since ngrok tunnels have unique URLs, we can't reliably auto-detect
    // the backend URL. The user should set NEXT_PUBLIC_API_URL for the backend ngrok URL.
    // However, we'll try using the same domain as a fallback.
    return `${protocol}//${hostname}`;
  }

  // For any other domain (production), use env var or return empty
  return process.env.NEXT_PUBLIC_API_URL || "";
}

