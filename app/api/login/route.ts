import { NextRequest, NextResponse } from "next/server";

// Demo auth gate. ponytail: hardcoded demo creds — swap for real auth later.
export async function POST(req: NextRequest) {
  const { username, password } = await req.json().catch(() => ({}));
  if (username === "demo" && password === "demo") {
    const res = NextResponse.json({ ok: true });
    res.cookies.set("gg_auth", "1", {
      httpOnly: true,
      path: "/",
      sameSite: "lax",
      maxAge: 60 * 60 * 8,
    });
    return res;
  }
  return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
}
