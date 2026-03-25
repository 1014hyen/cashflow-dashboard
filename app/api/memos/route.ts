import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";

export const dynamic = "force-dynamic";

type MemosData = {
  summaryMemos: Record<string, string>;
  rowRemarks: Record<string, string>;
};

export async function GET() {
  try {
    const filePath = path.join(process.cwd(), "data", "memos.json");
    if (!fs.existsSync(filePath)) {
      return NextResponse.json({ summaryMemos: {}, rowRemarks: {} });
    }
    const raw = fs.readFileSync(filePath, "utf-8");
    const data = JSON.parse(raw) as MemosData;
    return NextResponse.json(data);
  } catch {
    return NextResponse.json({ summaryMemos: {}, rowRemarks: {} });
  }
}
