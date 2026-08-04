"use client";

import { useEffect, useState } from "react";

export type ClientUserRole = "viewer" | "editor" | "admin";
export type ClientAuthUser = {
  id: number;
  email: string;
  name: string;
  role: ClientUserRole;
};

export function useAuthUser() {
  const [user, setUser] = useState<ClientAuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/auth/me")
      .then((response) => response.json())
      .then((data) => setUser(data.user ?? null))
      .finally(() => setLoading(false));
  }, []);

  return {
    user,
    loading,
    canEdit: user?.role === "editor" || user?.role === "admin",
    isAdmin: user?.role === "admin",
  };
}
