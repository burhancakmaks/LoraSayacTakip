import { jwtVerify } from "jose";
import { NextRequest, NextResponse } from "next/server";

const PUBLIC_PATHS = [
  "/signin",
  "/setup",
  "/forgot-password",
  "/api/auth/login",
  "/api/auth/setup",
  "/api/auth/recover",
  "/api/auth/me",
];
const ADMIN_PATHS = ["/sayac-aktarim", "/kullanicilar", "/islem-gecmisi"];

function secret() {
  const value = process.env.AUTH_SECRET?.trim();
  if (value) return new TextEncoder().encode(value);
  return new TextEncoder().encode("maski-local-development-secret-change-in-production");
}

function isPublic(pathname: string) {
  return PUBLIC_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`));
}

export async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  if (isPublic(pathname)) return NextResponse.next();

  const token = request.cookies.get("maski_session")?.value;
  let role: string | null = null;
  if (token) {
    try {
      const verified = await jwtVerify(token, secret());
      role = typeof verified.payload.role === "string" ? verified.payload.role : null;
    } catch {
      role = null;
    }
  }

  if (!role) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Oturum açmanız gerekiyor" }, { status: 401 });
    }
    const url = request.nextUrl.clone();
    url.pathname = "/signin";
    url.searchParams.set("next", `${pathname}${search}`);
    return NextResponse.redirect(url);
  }

  if (ADMIN_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`)) && role !== "admin") {
    const url = request.nextUrl.clone();
    url.pathname = "/map";
    url.search = "";
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|images/|icons/|templates/).*)"],
};
