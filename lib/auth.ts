/**
 * Client-side auth utilities
 */

import { apiFetch } from "./api";

export async function checkAuth(): Promise<boolean> {
  try {
    const response = await apiFetch("/auth/me");
    return response.ok;
  } catch {
    return false;
  }
}

export async function logout(): Promise<void> {
  try {
    await apiFetch("/auth/logout", {
      method: "POST",
    });
  } catch (error) {
    console.error("Logout error:", error);
  }
}

