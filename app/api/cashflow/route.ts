import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";

export const dynamic = "force-dynamic";

type CashflowRow = {
  name: string;
  values: (number | null)[];
};

type CashflowApiResponse = {
  headers: string[];
  rows: CashflowRow[];
};

function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === "," && !inQuotes) {
      result.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  result.push(current.trim());
  return result;
}

function parseNumber(v: string): number | null {
  const s = v.trim().replace(/,/g, "");
  if (!s) return null;
  const n = Number(s);
  return Number.isNaN(n) ? null : n;
}

function readCSV(filePath: string): CashflowApiResponse {
  const content = fs.readFileSync(filePath, "utf-8");
  const lines = content.split(/\r?\n/).filter((l) => l.trim());

  const headerLine = lines[0] ?? "";
  const headerCells = parseCSVLine(headerLine);
  const headers = headerCells.slice(1);

  const rows: CashflowRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = parseCSVLine(lines[i] ?? "");
    const name = (cells[0] ?? "").trim();
    if (!name) continue;
    const values = headers.map((_, colIdx) => parseNumber(cells[colIdx + 1] ?? ""));
    rows.push({ name, values });
  }

  return { headers, rows };
}

export async function GET() {
  try {
    const dataDir = path.join(process.cwd(), "data");

    const file2026 = path.join(dataDir, "2026cashflow_raw.csv");
    const file2025 = path.join(dataDir, "2025 cashflow_raw.csv");

    const exists2026 = fs.existsSync(file2026);
    const exists2025 = fs.existsSync(file2025);

    if (!exists2026 && !exists2025) {
      return NextResponse.json({ error: "CSV 파일을 찾을 수 없습니다." }, { status: 404 });
    }

    // 2026 파일이 25년+26년 통합 데이터이므로 우선 사용
    const filePath = exists2026 ? file2026 : file2025;
    const data = readCSV(filePath);

    return NextResponse.json(data);
  } catch (err) {
    const message = err instanceof Error ? err.message : "알 수 없는 오류";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
