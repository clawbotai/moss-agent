import { NextResponse } from "next/server";
import { ZodError } from "zod";

export function jsonOk<T>(data: T, init?: ResponseInit) {
  return NextResponse.json(data, init);
}

export function jsonError(error: unknown, status = 500) {
  if (error instanceof ZodError) {
    return NextResponse.json(
      { error: "请求参数无效", details: error.flatten() },
      { status: 400 },
    );
  }

  const message = error instanceof Error ? error.message : "服务器错误";
  return NextResponse.json({ error: message }, { status });
}
