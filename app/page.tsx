"use client";

import React from "react";

// ──────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────
type CashflowItem = {
  name: string;
  valuesByMonth: (number | null)[];
};

type MonthColumn = {
  label: string;
  colIndex: number;
  isMonthly: boolean;
};

type ParsedCashflow = {
  months: MonthColumn[];
  sectionOrder: string[];
  sections: Record<string, CashflowItem[]>;
  kpis: Record<string, number | null>;
  kpiSeries: Record<string, (number | null)[]>;
  closingBalanceRows: CashflowItem[];
  closingBalanceSplit: {
    total: CashflowItem | null;
    krw: CashflowItem | null;
    usd: CashflowItem | null;
    cny: CashflowItem | null;
  };
  sectionMapping: Record<string, string[]>;
  headerRowIndex: number;
  rawRows: unknown[][];
};

type CsvApiRow = { name: string; values: (number | null)[] };
type CsvApiResponse = { headers: string[]; rows: CsvApiRow[] };

// ──────────────────────────────────────────────
// Constants
// ──────────────────────────────────────────────
const BASE_CASH_SECTION = "기초현금";
const KPI_KEYS = ["기말잔액(KRW)", "기말잔액(USD)", "기말잔액(CNY)"] as const;

// ──────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────
function parseNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") {
    const s = value.trim().replace(/,/g, "");
    if (!s) return null;
    const n = Number(s);
    return Number.isNaN(n) ? null : n;
  }
  return null;
}

function formatNumberKR(value: number) {
  return new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 2 }).format(value);
}

function formatNumberKRInt(value: number) {
  return new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 0 }).format(Math.trunc(value));
}

function isValidMonthLabel(text: string): boolean {
  return /^\d{2}년\s*(?:[1-9]|1[0-2])월$/.test(text);
}

function isYearTotalLabel(text: string): boolean {
  return /^\d{2}년\s*(계|합계|\(합계\))$/.test(text);
}

function formatMonthLabel(label: string): string {
  const m = label.match(/^(\d{2})년\s*(\d{1,2})월$/);
  if (!m) return label;
  const month = String(parseInt(m[2], 10)).padStart(2, "0");
  return `${m[1]}년 ${month}월`;
}

function formatYearMonthLabel(label: string): string {
  const m = label.match(/^(\d{2})년\s*(\d{1,2})월$/);
  if (!m) return label;
  const year = "20" + m[1];
  const month = String(parseInt(m[2], 10)).padStart(2, "0");
  return `${year}년 ${month}월`;
}

function extractMonthNum(label: string): number | null {
  const m = label.match(/^\d{2}년\s*(\d{1,2})월$/);
  return m ? parseInt(m[1], 10) : null;
}

function isSummaryRow(itemName: string): boolean {
  const n = normalizeLabel(itemName);
  return (
    n.includes("소계") ||
    n.includes("합계") ||
    itemName.trim() === "합계" ||
    itemName.trim().startsWith("OC 차입금") ||
    itemName.trim().startsWith("OC차입금")
  );
}

function normalizeLabel(text: string): string {
  return text.replace(/\s/g, "");
}

function isClosingBalanceTotalRow(itemName: string): boolean {
  return normalizeLabel(itemName).includes("조달후기말잔액");
}

function isClosingBalanceCurrencyRow(itemName: string): boolean {
  return (
    itemName.includes("기말잔액(KRW)") ||
    itemName.includes("기말잔액(USD)") ||
    itemName.includes("기말잔액(CNY)")
  );
}

// ──────────────────────────────────────────────
// CSV → ParsedCashflow 변환
// ──────────────────────────────────────────────
function parseCsvApiToCashflow(data: CsvApiResponse): ParsedCashflow {
  const { headers, rows } = data;

  // 월 컬럼 목록 구성 (colIndex = headers 배열 인덱스)
  const months: MonthColumn[] = headers.map((label, idx) => ({
    label,
    colIndex: idx,
    isMonthly: isValidMonthLabel(label),
  })).filter((m) => m.isMonthly || isYearTotalLabel(m.label));

  const sections: Record<string, CashflowItem[]> = {};
  const sectionOrder: string[] = [];
  const kpis: Record<string, number | null> = {
    "기말잔액(KRW)": null,
    "기말잔액(USD)": null,
    "기말잔액(CNY)": null,
  };
  const kpiSeries: Record<string, (number | null)[]> = {
    "기말잔액(KRW)": [],
    "기말잔액(USD)": [],
    "기말잔액(CNY)": [],
  };
  const closingBalanceRows: CashflowItem[] = [];

  let currentSection: string | null = null;

  for (const row of rows) {
    const itemName = row.name;
    if (!itemName) continue;
    if (isSummaryRow(itemName)) continue;

    // month 컬럼 순서에 맞춘 valuesByMonth
    const valuesByMonth = months.map((m) => {
      const rawVal = row.values[m.colIndex];
      return parseNumber(rawVal);
    });

    // 섹션 헤더 감지 (①②③④ 포함된 행 또는 CASH FLOW 텍스트)
    if (
      /^[①②③④⑤]/.test(itemName) ||
      itemName.includes("CASH FLOW")
    ) {
      // 기초현금 섹션
      if (itemName.includes("기초현금")) {
        currentSection = BASE_CASH_SECTION;
        if (!sections[currentSection]) {
          sections[currentSection] = [];
        }
        sections[currentSection].push({ name: itemName, valuesByMonth });
        continue;
      }
      currentSection = itemName;
      if (!sections[currentSection]) {
        sections[currentSection] = [];
        sectionOrder.push(currentSection);
      }
      continue;
    }

    if (isClosingBalanceTotalRow(itemName)) {
      closingBalanceRows.push({ name: itemName, valuesByMonth });
      continue;
    }

    if (KPI_KEYS.some((kpiKey) => itemName.includes(kpiKey))) {
      const kpiKey = KPI_KEYS.find((key) => itemName.includes(key));
      if (!kpiKey) continue;
      const lastValue = [...valuesByMonth].reverse().find((v) => v !== null);
      kpis[kpiKey] = lastValue ?? null;
      kpiSeries[kpiKey] = valuesByMonth;
      if (isClosingBalanceCurrencyRow(itemName)) {
        closingBalanceRows.push({ name: itemName, valuesByMonth });
      }
      continue;
    }

    // 투자금융상품은 별도 섹션으로 분리해 조달 후 기말잔액 아래에 배치
    if (normalizeLabel(itemName).includes("투자금융상품")) {
      const SEC = "투자금융상품";
      if (!sections[SEC]) sections[SEC] = [];
      sections[SEC].push({ name: itemName, valuesByMonth });
      continue;
    }

    if (!currentSection) continue;

    if (!sections[currentSection]) {
      sections[currentSection] = [];
      if (!sectionOrder.includes(currentSection)) sectionOrder.push(currentSection);
    }
    sections[currentSection].push({ name: itemName, valuesByMonth });
  }

  // 중복 제거
  for (const sectionName of Object.keys(sections)) {
    const seen = new Map<string, CashflowItem>();
    for (const item of sections[sectionName]) {
      seen.set(item.name, item);
    }
    sections[sectionName] = Array.from(seen.values());
  }

  const normalizedOrder = [
    ...(sections[BASE_CASH_SECTION] ? [BASE_CASH_SECTION] : []),
    ...sectionOrder.filter((s) => s !== BASE_CASH_SECTION),
    // 투자금융상품은 조달 후 기말잔액 아래에 고정
    ...(sections["투자금융상품"] ? ["투자금융상품"] : []),
  ];

  const sectionMapping: Record<string, string[]> = {};
  for (const sectionName of normalizedOrder) {
    sectionMapping[sectionName] = (sections[sectionName] ?? []).map((item) => item.name);
  }

  const closingBalanceSplit = {
    total: closingBalanceRows.find((r) => isClosingBalanceTotalRow(r.name)) ?? null,
    krw: closingBalanceRows.find((r) => r.name.includes("기말잔액(KRW)")) ?? null,
    usd: closingBalanceRows.find((r) => r.name.includes("기말잔액(USD)")) ?? null,
    cny: closingBalanceRows.find((r) => r.name.includes("기말잔액(CNY)")) ?? null,
  };

  return {
    months,
    sectionOrder: normalizedOrder,
    sections,
    kpis,
    kpiSeries,
    closingBalanceRows,
    closingBalanceSplit,
    sectionMapping,
    headerRowIndex: 0,
    rawRows: [],
  };
}

// ──────────────────────────────────────────────
// Computation helpers (동일 유지)
// ──────────────────────────────────────────────
function sumSectionValues(items: CashflowItem[], monthIndex: number): number | null {
  let sum = 0;
  let count = 0;
  for (const item of items) {
    const value = item.valuesByMonth[monthIndex];
    if (value === null || value === undefined) continue;
    sum += value;
    count += 1;
  }
  return count > 0 ? sum : null;
}

type ColWithMeta = MonthColumn & {
  isComputed?: boolean;
  isYoYRate?: boolean;
  baseIdx?: number;
  subtractIdx?: number;
  sumOverIndices?: number[];
};

function getSubtotalForColumn(
  items: CashflowItem[],
  col: ColWithMeta,
  months: MonthColumn[],
): number | null {
  if (col.isComputed && typeof col.baseIdx === "number" && typeof col.subtractIdx === "number") {
    let sumBase = 0;
    let sumSub = 0;
    for (const item of items) {
      const base = col.baseIdx >= 0 ? item.valuesByMonth[col.baseIdx] : null;
      const sub = col.subtractIdx >= 0 ? item.valuesByMonth[col.subtractIdx] : null;
      if (base !== null && sub !== null) {
        sumBase += base;
        sumSub += sub;
      }
    }
    if (col.isYoYRate) {
      if (sumSub === 0) return null;
      return ((sumBase - sumSub) / Math.abs(sumSub)) * 100;
    }
    return sumBase - sumSub;
  }
  if (col.sumOverIndices && col.sumOverIndices.length > 0) {
    let total = 0;
    let hasValue = false;
    for (const item of items) {
      for (const idx of col.sumOverIndices) {
        const v = item.valuesByMonth[idx];
        if (v !== null && v !== undefined) {
          total += v;
          hasValue = true;
        }
      }
    }
    return hasValue ? total : null;
  }
  const idx = months.findIndex((m) => m.colIndex === col.colIndex);
  if (idx < 0) return null;
  return sumSectionValues(items, idx);
}

function formatPercent(value: number): string {
  const nf = new Intl.NumberFormat("ko-KR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
    signDisplay: "always",
  });
  return `${nf.format(value)}%`;
}

type SummaryRow = { label: string; vPrev: number | null; vCurr: number | null; diff: number | null };

function getTopSummaryRows(
  sectionRows: { sectionName: string; items: CashflowItem[] }[],
  months: MonthColumn[],
  selectedMonthColIndex: number | null,
): { rows: SummaryRow[]; labelPrev: string; labelCurr: string } {
  const rows: SummaryRow[] = [];
  if (selectedMonthColIndex === null || months.length === 0) {
    return { rows, labelPrev: "2025년", labelCurr: "2026년" };
  }

  const colCurr = months.find((m) => m.colIndex === selectedMonthColIndex);
  if (!colCurr || !colCurr.isMonthly) return { rows, labelPrev: "2025년", labelCurr: "2026년" };

  const labelCurr = formatYearMonthLabel(colCurr.label);
  const selectedMonthNum = extractMonthNum(colCurr.label);
  const colPrev = months.find(
    (m) =>
      m.isMonthly &&
      /^25년\s/.test(m.label) &&
      extractMonthNum(m.label) === selectedMonthNum,
  );
  if (!colPrev) {
    const labelPrev =
      selectedMonthNum != null ? `2025년 ${String(selectedMonthNum).padStart(2, "0")}월` : "2025년";
    return { rows, labelPrev, labelCurr };
  }

  const labelPrev = formatYearMonthLabel(colPrev.label);
  const colPrevMeta = { ...colPrev } as ColWithMeta;
  const colCurrMeta = { ...colCurr } as ColWithMeta;

  let basePrev: number | null = null;
  let baseCurr: number | null = null;
  const baseSection = sectionRows.find((s) => s.sectionName === "기초현금");
  if (baseSection) {
    basePrev = getSubtotalForColumn(baseSection.items, colPrevMeta, months);
    baseCurr = getSubtotalForColumn(baseSection.items, colCurrMeta, months);
    const diff = basePrev !== null && baseCurr !== null ? baseCurr - basePrev : null;
    rows.push({ label: "기초현금", vPrev: basePrev, vCurr: baseCurr, diff });
  }

  const cfPatterns = ["영업 CASH FLOW", "투자 CASH FLOW", "조달 CASH FLOW"];
  let sumPrev = 0;
  let sumCurr = 0;
  for (const pattern of cfPatterns) {
    const section = sectionRows.find((s) => s.sectionName.includes(pattern));
    if (!section) continue;
    const vPrev = getSubtotalForColumn(section.items, colPrevMeta, months);
    const vCurr = getSubtotalForColumn(section.items, colCurrMeta, months);
    const diff = vPrev !== null && vCurr !== null ? vCurr - vPrev : null;
    rows.push({ label: pattern, vPrev, vCurr, diff });
    if (vPrev !== null) sumPrev += vPrev;
    if (vCurr !== null) sumCurr += vCurr;
  }

  rows.push({
    label: "CASH FLOW 계",
    vPrev: sumPrev,
    vCurr: sumCurr,
    diff: sumCurr - sumPrev,
  });

  const endPrev = basePrev !== null ? basePrev + sumPrev : null;
  const endCurr = baseCurr !== null ? baseCurr + sumCurr : null;
  const endDiff = endPrev !== null && endCurr !== null ? endCurr - endPrev : null;
  rows.push({ label: "기말현금", vPrev: endPrev, vCurr: endCurr, diff: endDiff });

  return { rows, labelPrev, labelCurr };
}

type MonthlySimRow = {
  monthLabel: string;
  monthIdx: number;
  openingCash: number;
  operatingCF: number;
  investingCF: number;
  financingCF: number;
  endingCash: number;
};

type SimulationResult = MonthlySimRow & {
  simOpeningCash: number;
  simOperatingCF: number;
  simEndingCash: number;
  diff: number;
  isSimulated: boolean;
};

function getMonthlyValues(
  sectionRows: { sectionName: string; items: CashflowItem[] }[],
  months: MonthColumn[],
): MonthlySimRow[] {
  const months26 = months.filter((m) => m.isMonthly && /^26년\s/.test(m.label));
  const result: MonthlySimRow[] = [];

  const baseSection = sectionRows.find((s) => s.sectionName === "기초현금");
  const opSection = sectionRows.find((s) => s.sectionName.includes("영업 CASH FLOW"));
  const invSection = sectionRows.find((s) => s.sectionName.includes("투자 CASH FLOW"));
  const finSection = sectionRows.find((s) => s.sectionName.includes("조달 CASH FLOW"));
  const closingSection = sectionRows.find((s) => s.sectionName === "조달 후 기말잔액");

  for (const month of months26) {
    const monthIdx = months.findIndex((m) => m.colIndex === month.colIndex);
    const opening = baseSection ? sumSectionValues(baseSection.items, monthIdx) : 0;
    const operating = opSection ? sumSectionValues(opSection.items, monthIdx) : 0;
    const investing = invSection ? sumSectionValues(invSection.items, monthIdx) : 0;
    const financing = finSection ? sumSectionValues(finSection.items, monthIdx) : 0;
    let ending = closingSection ? sumSectionValues(closingSection.items, monthIdx) : null;
    if (ending === null) {
      ending = (opening ?? 0) + (operating ?? 0) + (investing ?? 0) + (financing ?? 0);
    }
    result.push({
      monthLabel: formatYearMonthLabel(month.label),
      monthIdx,
      openingCash: opening ?? 0,
      operatingCF: operating ?? 0,
      investingCF: investing ?? 0,
      financingCF: financing ?? 0,
      endingCash: ending,
    });
  }
  return result;
}

function simulateOperatingCFCascade(
  monthlyData: MonthlySimRow[],
  selectedMonthColIndex: number,
  multiplier: number,
  months: MonthColumn[],
): SimulationResult[] {
  const selectedIdx = monthlyData.findIndex(
    (r) => months[r.monthIdx]?.colIndex === selectedMonthColIndex,
  );
  if (selectedIdx < 0) return [];

  const results: SimulationResult[] = [];
  for (let i = 0; i < monthlyData.length; i++) {
    const row = monthlyData[i];
    let simOpening: number;
    let simOperating: number;
    let simEnding: number;

    if (i < selectedIdx) {
      simOpening = row.openingCash;
      simOperating = row.operatingCF;
      simEnding = row.endingCash;
    } else if (i === selectedIdx) {
      simOpening = row.openingCash;
      simOperating = row.operatingCF * multiplier;
      simEnding = simOpening + simOperating + row.investingCF + row.financingCF;
    } else {
      simOpening = results[i - 1]!.simEndingCash;
      simOperating = row.operatingCF;
      simEnding = simOpening + simOperating + row.investingCF + row.financingCF;
    }

    results.push({
      ...row,
      simOpeningCash: simOpening,
      simOperatingCF: simOperating,
      simEndingCash: simEnding,
      diff: simEnding - row.endingCash,
      isSimulated: i >= selectedIdx,
    });
  }
  return results;
}

// ──────────────────────────────────────────────
// Main Component
// ──────────────────────────────────────────────
export default function Home() {
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [parsed, setParsed] = React.useState<ParsedCashflow | null>(null);
  const [collapsedSections, setCollapsedSections] = React.useState<Record<string, boolean>>({});
  const [selectedKpiMonthColIndex, setSelectedKpiMonthColIndex] = React.useState<number | null>(null);
  const [monthlyDataExpanded, setMonthlyDataExpanded] = React.useState(true);
  const [rowRemarks, setRowRemarks] = React.useState<Record<string, string>>({});
  const [isRemarksEditMode, setIsRemarksEditMode] = React.useState(false);
  const [simSelectedMonthColIndex, setSimSelectedMonthColIndex] = React.useState<number | null>(null);
  const [simMultiplier, setSimMultiplier] = React.useState(100);
  const [summaryMemo, setSummaryMemo] = React.useState("");
  const [isSummaryMemoEditMode, setIsSummaryMemoEditMode] = React.useState(false);
  // memos.json 기준 월 추적 (UI 편집 vs 파일 구분용)
  const [memoBaseMonth, setMemoBaseMonth] = React.useState<string | null>(null);

  // 메모 변경 시 localStorage에 임시 저장
  React.useEffect(() => {
    try { localStorage.setItem("cashflow_summaryMemo", summaryMemo); } catch { /* noop */ }
  }, [summaryMemo]);

  React.useEffect(() => {
    try { localStorage.setItem("cashflow_rowRemarks", JSON.stringify(rowRemarks)); } catch { /* noop */ }
  }, [rowRemarks]);

  // 마운트 시 memos.json 로드 (파일 우선, 없으면 localStorage 폴백)
  React.useEffect(() => {
    async function loadMemos() {
      try {
        const res = await fetch("/api/memos");
        if (!res.ok) throw new Error("memos API failed");
        const data = (await res.json()) as {
          summaryMemos: Record<string, string>;
          rowRemarks: Record<string, string>;
        };
        // rowRemarks: 파일 값 우선, 나머지는 localStorage 병합
        const lsRemarks = (() => {
          try {
            const s = localStorage.getItem("cashflow_rowRemarks");
            return s ? (JSON.parse(s) as Record<string, string>) : {};
          } catch { return {}; }
        })();
        setRowRemarks({ ...lsRemarks, ...data.rowRemarks });

        // summaryMemo: 파일에 현재 월 값이 있으면 우선 사용, 없으면 localStorage
        const months = Object.keys(data.summaryMemos);
        if (months.length > 0) {
          // 가장 최근 월 키 사용
          const latestKey = months[months.length - 1]!;
          setMemoBaseMonth(latestKey);
          const fileVal = data.summaryMemos[latestKey] ?? "";
          if (fileVal) {
            setSummaryMemo(fileVal);
          } else {
            const lsVal = (() => { try { return localStorage.getItem("cashflow_summaryMemo") ?? ""; } catch { return ""; } })();
            setSummaryMemo(lsVal);
          }
        } else {
          const lsVal = (() => { try { return localStorage.getItem("cashflow_summaryMemo") ?? ""; } catch { return ""; } })();
          setSummaryMemo(lsVal);
        }
      } catch {
        // API 실패 시 localStorage 폴백
        try {
          const s = localStorage.getItem("cashflow_rowRemarks");
          if (s) setRowRemarks(JSON.parse(s) as Record<string, string>);
          setSummaryMemo(localStorage.getItem("cashflow_summaryMemo") ?? "");
        } catch { /* noop */ }
      }
    }
    void loadMemos();
  }, []);

  // 페이지 마운트 시 자동으로 CSV 데이터 로드
  React.useEffect(() => {
    let cancelled = false;

    async function loadData() {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch("/api/cashflow");
        if (!res.ok) {
          const body = await res.json().catch(() => ({})) as { error?: string };
          throw new Error(body.error ?? `서버 오류: ${res.status}`);
        }
        const data = (await res.json()) as CsvApiResponse;
        if (cancelled) return;

        const nextParsed = parseCsvApiToCashflow(data);
        setParsed(nextParsed);

        const now = new Date();
        const currentYY = String(now.getFullYear()).slice(-2);
        const currentMM = now.getMonth() + 1;

        const allMonthly = nextParsed.months.filter((m) => m.isMonthly);
        const months26 = allMonthly.filter((m) => /^26년\s/.test(m.label));

        // 오늘 날짜 기준 해당 월 컬럼 찾기 (예: "26년 3월")
        const todayMonth = allMonthly.find((m) => {
          const match = m.label.match(/^(\d{2})년\s*(\d{1,2})월$/);
          return match && match[1] === currentYY && parseInt(match[2], 10) === currentMM;
        });

        // 해당 월이 없으면 같은 연도의 가장 마지막 월, 그것도 없으면 전체 마지막 월
        const latestMonthly =
          todayMonth ??
          (months26.length > 0
            ? months26[months26.length - 1]
            : allMonthly[allMonthly.length - 1] ?? null);
        const colIdx = latestMonthly?.colIndex ?? null;
        setSelectedKpiMonthColIndex(colIdx);
        setSimSelectedMonthColIndex(colIdx);
        setCollapsedSections(() => {
          const next: Record<string, boolean> = {};
          for (const sectionName of nextParsed.sectionOrder) {
            next[sectionName] = false;
          }
          next["조달 후 기말잔액"] = false;
          return next;
        });
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "데이터를 불러오는 중 오류가 발생했습니다.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void loadData();
    return () => { cancelled = true; };
  }, []);

  const months = parsed?.months ?? [];
  const monthLabels = months.map((m) => m.label);
  const monthlyColumns = months.filter((m) => m.isMonthly && /^26년\s/.test(m.label));
  const selectedKpiMonthIndex =
    selectedKpiMonthColIndex === null
      ? -1
      : months.findIndex((m) => m.colIndex === selectedKpiMonthColIndex);
  const selectedKpiMonthLabel =
    selectedKpiMonthIndex >= 0 ? months[selectedKpiMonthIndex]?.label ?? "" : "";

  const kpiCards = parsed
    ? KPI_KEYS.map((kpiKey) => ({
        key: kpiKey,
        value:
          selectedKpiMonthIndex >= 0
            ? (parsed.kpiSeries[kpiKey]?.[selectedKpiMonthIndex] ?? null)
            : parsed.kpis[kpiKey],
      }))
    : [];

  const tableColumns = React.useMemo(() => {
    if (!parsed) return [];
    const months26Only = months.filter((m) => m.isMonthly && /^26년\s/.test(m.label));
    if (monthlyDataExpanded) return months26Only;
    const colSelected = months.find((m) => m.colIndex === selectedKpiMonthColIndex);
    const selectedMonthNum = colSelected ? extractMonthNum(colSelected.label) : 12;
    const col25SameMonth = months.find(
      (m) =>
        m.isMonthly &&
        /^25년\s/.test(m.label) &&
        extractMonthNum(m.label) === selectedMonthNum,
    );
    const col26SameMonth = months.find(
      (m) =>
        m.isMonthly &&
        /^26년\s/.test(m.label) &&
        extractMonthNum(m.label) === selectedMonthNum,
    );
    const col25 = months.find((m) => /25년\s*(계|합계)/.test(m.label) || /25년\s*\(합계\)/.test(m.label));
    const months26Indices = months
      .map((m, i) => (m.isMonthly && /^26년\s/.test(m.label) ? i : -1))
      .filter((i) => i >= 0);
    const baseIdx = col26SameMonth ? months.findIndex((m) => m.colIndex === col26SameMonth.colIndex) : -1;
    const subtractIdx = col25SameMonth ? months.findIndex((m) => m.colIndex === col25SameMonth.colIndex) : -1;
    const cols: ColWithMeta[] = [];
    if (col25SameMonth) cols.push(col25SameMonth);
    if (col26SameMonth) cols.push(col26SameMonth);
    cols.push({
      label: "계획-전년",
      colIndex: -1,
      isMonthly: false,
      isComputed: true,
      baseIdx,
      subtractIdx,
    } as ColWithMeta);
    cols.push({
      label: "전년대비 증감율(%)",
      colIndex: -1,
      isMonthly: false,
      isComputed: true,
      isYoYRate: true,
      baseIdx,
      subtractIdx,
    } as ColWithMeta);
    if (col25) cols.push(col25);
    if (months26Indices.length > 0) {
      cols.push({
        label: "26년 계",
        colIndex: -1,
        isMonthly: false,
        sumOverIndices: months26Indices,
      } as ColWithMeta);
    }
    return cols.length > 0 ? cols : months26Only;
  }, [parsed, monthlyDataExpanded, months, selectedKpiMonthColIndex]);

  const sectionRows = parsed
    ? [
        ...parsed.sectionOrder.map((sectionName) => ({
          sectionName,
          items: parsed.sections[sectionName] ?? [],
        })),
        { sectionName: "조달 후 기말잔액", items: parsed.closingBalanceRows },
      ]
    : [];

  const summaryData = React.useMemo(
    () => getTopSummaryRows(sectionRows, months, selectedKpiMonthColIndex),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sectionRows, months, selectedKpiMonthColIndex],
  );

  const simMonthColIndex = simSelectedMonthColIndex ?? monthlyColumns[0]?.colIndex ?? null;

  const monthlySimData = React.useMemo(
    () => getMonthlyValues(sectionRows, months),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sectionRows, months],
  );

  const simulationResults = React.useMemo(() => {
    if (!simMonthColIndex || simMultiplier === 100)
      return monthlySimData.map((r) => ({
        ...r,
        simOpeningCash: r.openingCash,
        simOperatingCF: r.operatingCF,
        simEndingCash: r.endingCash,
        diff: 0,
        isSimulated: false,
      }));
    return simulateOperatingCFCascade(monthlySimData, simMonthColIndex, simMultiplier / 100, months);
  }, [monthlySimData, simMonthColIndex, simMultiplier, months]);

  // ──────────────────────────────────────────────
  // Render
  // ──────────────────────────────────────────────
  return (
    <div className="min-h-full bg-zinc-50 font-sans">
      <main className="mx-auto w-full max-w-[92rem] px-3 py-6 sm:px-4 lg:px-6">
        <header className="mb-4">
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-900">
            월별 캐시플로우 대시보드
          </h1>
          <p className="mt-2 text-sm text-zinc-600">
            기초현금 + 영업/투자/조달 CASH FLOW 흐름과 기말잔액을 월별로 확인합니다.
          </p>
        </header>

        {/* 로딩 상태 */}
        {loading && (
          <section className="mt-10 rounded-2xl border border-zinc-200 bg-white p-8 text-center">
            <div className="text-sm text-zinc-500">데이터를 불러오는 중...</div>
          </section>
        )}

        {/* 오류 상태 */}
        {!loading && error && (
          <section className="mt-4 rounded-xl border border-red-200 bg-red-50 p-4">
            <p className="text-sm text-red-700">{error}</p>
          </section>
        )}

        {/* 데이터 로드 완료 */}
        {!loading && parsed && (
          <>
            <section className="mb-5">
              <div className="mb-2 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
                <h2 className="text-base font-semibold text-zinc-900">기말잔액 기준 월</h2>
                <div className="w-full sm:w-64">
                  <select
                    className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900"
                    value={selectedKpiMonthColIndex ?? ""}
                    onChange={(e) => {
                      if (!e.target.value) {
                        setSelectedKpiMonthColIndex(null);
                        return;
                      }
                      const next = Number(e.target.value);
                      setSelectedKpiMonthColIndex(Number.isNaN(next) ? null : next);
                    }}
                  >
                    {monthlyColumns.map((month) => (
                      <option key={month.colIndex} value={month.colIndex}>
                        {formatMonthLabel(month.label)}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {kpiCards.map((kpi) => (
                  <div
                    key={kpi.key}
                    className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm"
                  >
                    <div className="text-sm font-medium text-zinc-600">{kpi.key}</div>
                    <div className="mt-2 text-2xl font-semibold tracking-tight text-zinc-900">
                      {kpi.value === null ? "-" : formatNumberKRInt(kpi.value)}
                    </div>
                    <div className="mt-1 text-xs text-zinc-500">
                      {selectedKpiMonthLabel
                        ? `(${formatMonthLabel(selectedKpiMonthLabel)} 기준)`
                        : ""}
                    </div>
                  </div>
                ))}
              </div>
            </section>

            <section className="mb-5">
              <div className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm sm:p-5">
                <h2 className="text-base font-semibold text-zinc-900 sm:text-lg">월별 요약 비교</h2>
                <p className="mt-1 text-xs text-zinc-600 sm:text-sm">
                  선택한 월 기준 전년동월 비교
                </p>
                <div className="mt-4 flex flex-col gap-4 lg:flex-row lg:items-stretch">
                  <div className="min-w-0 flex-1 overflow-x-auto">
                    <table className="w-full min-w-[22rem] border-collapse text-sm">
                      <thead>
                        <tr className="border-b border-zinc-200 bg-zinc-50">
                          <th className="min-w-[7rem] px-4 py-2.5 text-left font-medium text-zinc-700">구분</th>
                          <th className="min-w-[6rem] px-4 py-2.5 text-right font-medium text-zinc-700">
                            {summaryData.labelPrev}
                          </th>
                          <th className="min-w-[6rem] px-4 py-2.5 text-right font-medium text-zinc-700">
                            {summaryData.labelCurr}
                          </th>
                          <th className="min-w-[6rem] px-4 py-2.5 text-right font-medium text-zinc-700">증감액</th>
                        </tr>
                      </thead>
                      <tbody>
                        {summaryData.rows.map((r) => {
                          const diffSign = r.diff != null && r.diff >= 0 ? "+" : "";
                          const diffStr = r.diff != null ? `${diffSign}${formatNumberKRInt(r.diff)}` : "-";
                          const isNegative = r.diff != null && r.diff < 0;
                          const rowBg =
                            r.label === "기초현금"
                              ? "bg-zinc-100"
                              : r.label === "기말현금"
                                ? "bg-emerald-50"
                                : "bg-sky-50";
                          const isBold =
                            r.label === "기초현금" ||
                            r.label === "CASH FLOW 계" ||
                            r.label === "기말현금";
                          const fontWeight = isBold ? "font-semibold" : "";
                          return (
                            <tr key={r.label} className={`border-b border-zinc-100 ${rowBg}`}>
                              <td className={`px-4 py-2 ${isBold ? "font-semibold" : "font-medium"} text-zinc-900 ${rowBg}`}>
                                {r.label}
                              </td>
                              <td className={`px-4 py-2 text-right text-zinc-900 ${rowBg} ${fontWeight}`}>
                                {r.vPrev != null ? formatNumberKRInt(r.vPrev) : "-"}
                              </td>
                              <td className={`px-4 py-2 text-right text-zinc-900 ${rowBg} ${fontWeight}`}>
                                {r.vCurr != null ? formatNumberKRInt(r.vCurr) : "-"}
                              </td>
                              <td
                                className={`px-4 py-2 text-right ${rowBg} ${fontWeight} ${
                                  isNegative ? "text-red-600" : "text-zinc-900"
                                }`}
                              >
                                {diffStr}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  <div className="min-w-0 shrink-0 rounded-lg border border-zinc-200 bg-zinc-50/50 p-3 lg:w-[28rem]">
                    <div className="flex items-center justify-between">
                      <label className="block text-xs font-medium text-zinc-600">
                        {summaryData.labelCurr} 캐시플로우 보고사항
                      </label>
                      <button
                        type="button"
                        onClick={() => setIsSummaryMemoEditMode((prev) => !prev)}
                        className={`rounded px-2 py-1 text-xs font-medium transition-colors ${
                          isSummaryMemoEditMode
                            ? "bg-emerald-600 text-white hover:bg-emerald-700"
                            : "bg-zinc-200 text-zinc-700 hover:bg-zinc-300"
                        }`}
                      >
                        {isSummaryMemoEditMode ? "편집 완료" : "편집"}
                      </button>
                    </div>
                    {isSummaryMemoEditMode ? (
                      <textarea
                        value={summaryMemo}
                        onChange={(e) => setSummaryMemo(e.target.value)}
                        placeholder={`• 주요 변동 요약\n• 검토 사항\n• 특이 사항`}
                        rows={10}
                        className="mt-1.5 w-full resize-y rounded border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 placeholder:text-zinc-400 focus:border-zinc-300 focus:outline-none focus:ring-1 focus:ring-zinc-300"
                      />
                    ) : (
                      <div className="mt-1.5 min-h-[14rem] whitespace-pre-wrap rounded border border-transparent px-3 py-2 text-sm text-zinc-700">
                        {summaryMemo || "—"}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </section>

            <section className="mb-5">
              <div className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm sm:p-5">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <h2 className="text-lg font-semibold text-zinc-900">2026년 월별 CASH FLOW</h2>
                    <p className="mt-1 text-sm text-zinc-600">
                      섹션 행을 클릭하면 접기/펼치기가 됩니다. (색상으로 섹션 구분)
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-wrap items-center gap-3">
                    <span className="text-xs text-zinc-500">(단위: 백만원)</span>
                    <button
                      type="button"
                      onClick={() => setIsRemarksEditMode((prev) => !prev)}
                      className={`rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
                        isRemarksEditMode
                          ? "bg-emerald-600 text-white hover:bg-emerald-700"
                          : "bg-zinc-200 text-zinc-800 hover:bg-zinc-300"
                      }`}
                    >
                      {isRemarksEditMode ? "편집 완료" : "편집"}
                    </button>
                    <button
                      type="button"
                      onClick={() => setMonthlyDataExpanded((prev) => !prev)}
                      className="rounded-lg bg-zinc-800 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-zinc-700"
                    >
                      {monthlyDataExpanded ? "월별 데이터 접기 ▼" : "월별 데이터 펼치기 ▶"}
                    </button>
                  </div>
                </div>

                <div className="mt-4 overflow-x-auto [-webkit-overflow-scrolling:touch]">
                  <table className="min-w-full border-collapse text-sm">
                    <thead>
                      <tr className="bg-zinc-100">
                        <th className="sticky left-0 z-10 min-w-[14rem] max-w-[28rem] bg-zinc-100 px-4 py-2.5 text-left text-sm font-medium leading-snug whitespace-normal break-words text-zinc-700 shadow-[2px_0_0_0_rgb(244_244_245)]">
                          계정과목
                        </th>
                        {tableColumns.map((col) => {
                          const isVirtual = "isComputed" in col && col.isComputed;
                          const isSelected = !isVirtual && col.colIndex === selectedKpiMonthColIndex;
                          const colKey =
                            "isYoYRate" in col && col.isYoYRate
                              ? "전년대비증감율"
                              : "isComputed" in col && col.isComputed
                                ? "계획-전년"
                                : col.colIndex;
                          return (
                            <th
                              key={colKey}
                              className={`px-3 py-2 text-right font-medium text-zinc-700 ${
                                isSelected ? "bg-amber-100" : ""
                              }`}
                            >
                              {col.isMonthly
                                ? formatYearMonthLabel(col.label)
                                : col.label}
                            </th>
                          );
                        })}
                        <th className="min-w-[12rem] max-w-[20rem] bg-zinc-100 px-3 py-2.5 text-left text-sm font-medium text-zinc-700">
                          설명
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {sectionRows.map((section) => {
                        const isCollapsed = collapsedSections[section.sectionName] ?? false;
                        const headerBg =
                          section.sectionName === "기초현금"
                            ? "bg-zinc-200"
                            : section.sectionName === "조달 후 기말잔액"
                              ? "bg-emerald-100"
                              : "bg-sky-100";
                        return (
                          <React.Fragment key={section.sectionName}>
                            <tr className={`${headerBg} border-t border-zinc-300`}>
                              <td
                                className={`${headerBg} sticky left-0 z-[8] min-w-[14rem] max-w-[28rem] px-4 py-2.5 text-left text-sm font-semibold leading-snug whitespace-normal break-words text-zinc-900 shadow-[2px_0_0_0_rgb(244_244_245)] cursor-pointer`}
                                onClick={() =>
                                  setCollapsedSections((prev) => ({
                                    ...prev,
                                    [section.sectionName]: !isCollapsed,
                                  }))
                                }
                              >
                                {isCollapsed ? "▶" : "▼"} {section.sectionName}
                              </td>
                              <td
                                colSpan={tableColumns.length}
                                className={`${headerBg} px-3 py-2 text-right text-xs text-zinc-700 cursor-pointer`}
                                onClick={() =>
                                  setCollapsedSections((prev) => ({
                                    ...prev,
                                    [section.sectionName]: !isCollapsed,
                                  }))
                                }
                              >
                                {(section.sectionName === "조달 후 기말잔액"
                                  ? section.items.filter((i) => !isClosingBalanceTotalRow(i.name))
                                  : section.items
                                ).length}개 항목
                              </td>
                              <td className={`${headerBg} px-3 py-2`} />
                            </tr>

                            {!isCollapsed &&
                              ((section.sectionName === "조달 후 기말잔액"
                                ? section.items.filter((i) => !isClosingBalanceTotalRow(i.name))
                                : section.items
                              ).length === 0 ? (
                                <tr>
                                  <td
                                    colSpan={tableColumns.length + 2}
                                    className="px-3 py-6 text-center text-sm text-zinc-500"
                                  >
                                    표시할 항목이 없습니다.
                                  </td>
                                </tr>
                              ) : (
                                <>
                                  {(section.sectionName === "조달 후 기말잔액"
                                    ? section.items.filter((i) => !isClosingBalanceTotalRow(i.name))
                                    : section.items
                                  ).map((item) => (
                                    <tr
                                      key={`${section.sectionName}-${item.name}`}
                                      className="border-t border-zinc-200"
                                    >
                                      <td className="sticky left-0 z-[9] min-w-[14rem] max-w-[28rem] whitespace-normal break-words bg-white px-4 py-2 pl-8 font-medium leading-snug text-zinc-900 shadow-[2px_0_0_0_rgb(255_255_255)]">
                                        {item.name}
                                      </td>
                                      {tableColumns.map((col) => {
                                        let v: number | null;
                                        const colMeta = col as ColWithMeta;
                                        if (
                                          colMeta.isComputed &&
                                          typeof colMeta.baseIdx === "number" &&
                                          typeof colMeta.subtractIdx === "number"
                                        ) {
                                          const base =
                                            colMeta.baseIdx >= 0 ? item.valuesByMonth[colMeta.baseIdx] : null;
                                          const sub =
                                            colMeta.subtractIdx >= 0
                                              ? item.valuesByMonth[colMeta.subtractIdx]
                                              : null;
                                          if (base !== null && sub !== null) {
                                            if (colMeta.isYoYRate) {
                                              v = sub === 0 ? null : ((base - sub) / Math.abs(sub)) * 100;
                                            } else {
                                              v = base - sub;
                                            }
                                          } else v = null;
                                        } else if (colMeta.sumOverIndices && colMeta.sumOverIndices.length > 0) {
                                          let sum = 0;
                                          let hasVal = false;
                                          for (const idx of colMeta.sumOverIndices) {
                                            const x = item.valuesByMonth[idx];
                                            if (x !== null && x !== undefined) {
                                              sum += x;
                                              hasVal = true;
                                            }
                                          }
                                          v = hasVal ? sum : null;
                                        } else {
                                          const idx = months.findIndex((m) => m.colIndex === col.colIndex);
                                          v = idx >= 0 ? item.valuesByMonth[idx] : null;
                                        }
                                        const isSelected =
                                          !("isComputed" in col && col.isComputed) &&
                                          col.colIndex === selectedKpiMonthColIndex;
                                        const isYoY = "isYoYRate" in col && col.isYoYRate;
                                        const cellKey =
                                          isYoY
                                            ? "전년대비증감율"
                                            : "isComputed" in col && col.isComputed
                                              ? "계획-전년"
                                              : colMeta.sumOverIndices
                                                ? "26년계"
                                                : col.colIndex;
                                        return (
                                          <td
                                            key={cellKey}
                                            className={`px-3 py-2 text-right text-zinc-900 ${
                                              isSelected ? "bg-amber-50" : ""
                                            }`}
                                          >
                                            {v === null ? "-" : isYoY ? formatPercent(v) : formatNumberKRInt(v)}
                                          </td>
                                        );
                                      })}
                                      <td className="bg-white px-3 py-1.5 align-top">
                                        {isRemarksEditMode ? (
                                          <input
                                            type="text"
                                            value={rowRemarks[`${section.sectionName}-${item.name}`] ?? ""}
                                            onChange={(e) =>
                                              setRowRemarks((prev) => ({
                                                ...prev,
                                                [`${section.sectionName}-${item.name}`]: e.target.value,
                                              }))
                                            }
                                            placeholder="설명 입력..."
                                            className="w-full min-w-[8rem] rounded border border-zinc-200 bg-zinc-50 px-2 py-1.5 text-xs text-zinc-900 placeholder:text-zinc-400 focus:border-zinc-300 focus:outline-none focus:ring-1 focus:ring-zinc-300"
                                          />
                                        ) : (
                                          <span className="block min-h-[1.75rem] min-w-[8rem] text-xs text-zinc-600">
                                            {rowRemarks[`${section.sectionName}-${item.name}`] || "—"}
                                          </span>
                                        )}
                                      </td>
                                    </tr>
                                  ))}
                                  <tr className="border-t-2 border-zinc-300 bg-zinc-50 font-semibold">
                                    <td className="sticky left-0 z-[9] min-w-[14rem] max-w-[28rem] bg-zinc-50 px-4 py-2 pl-8 font-semibold text-zinc-900 shadow-[2px_0_0_0_rgb(250_250_250)]">
                                      소계
                                    </td>
                                    {tableColumns.map((col) => {
                                      const itemsForSubtotal =
                                        section.sectionName === "조달 후 기말잔액"
                                          ? section.items.filter(
                                              (item) => !isClosingBalanceTotalRow(item.name),
                                            )
                                          : section.items;
                                      const subTotal = getSubtotalForColumn(
                                        itemsForSubtotal,
                                        col,
                                        months,
                                      );
                                      const isSelected =
                                        !("isComputed" in col && col.isComputed) &&
                                        col.colIndex === selectedKpiMonthColIndex;
                                      const isYoY = "isYoYRate" in col && col.isYoYRate;
                                      const subKey =
                                        isYoY
                                          ? "전년대비증감율"
                                          : "isComputed" in col && col.isComputed
                                            ? "계획-전년"
                                            : (col as ColWithMeta).sumOverIndices
                                              ? "26년계"
                                              : col.colIndex;
                                      return (
                                        <td
                                          key={subKey}
                                          className={`px-3 py-2 text-right text-zinc-900 ${
                                            isSelected ? "bg-amber-50" : "bg-zinc-50"
                                          }`}
                                        >
                                          {subTotal === null
                                            ? "-"
                                            : isYoY
                                              ? formatPercent(subTotal)
                                              : formatNumberKRInt(subTotal)}
                                        </td>
                                      );
                                    })}
                                    <td className="bg-zinc-50 px-3 py-1.5 align-top">
                                      {isRemarksEditMode ? (
                                        <input
                                          type="text"
                                          value={rowRemarks[`${section.sectionName}-소계`] ?? ""}
                                          onChange={(e) =>
                                            setRowRemarks((prev) => ({
                                              ...prev,
                                              [`${section.sectionName}-소계`]: e.target.value,
                                            }))
                                          }
                                          placeholder="설명 입력..."
                                          className="w-full min-w-[8rem] rounded border border-zinc-200 bg-white px-2 py-1.5 text-xs text-zinc-900 placeholder:text-zinc-400 focus:border-zinc-300 focus:outline-none focus:ring-1 focus:ring-zinc-300"
                                        />
                                      ) : (
                                        <span className="block min-h-[1.75rem] min-w-[8rem] text-xs text-zinc-600">
                                          {rowRemarks[`${section.sectionName}-소계`] || "—"}
                                        </span>
                                      )}
                                    </td>
                                  </tr>
                                </>
                              ))}
                          </React.Fragment>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </section>

            <section className="mb-5">
              <div className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm sm:p-5">
                <div className="flex items-start justify-between">
                  <h2 className="text-base font-semibold text-zinc-900 sm:text-lg">
                    영업 CASH FLOW 민감도 시뮬레이션
                  </h2>
                  <span className="text-xs text-zinc-500">(단위: 백만원)</span>
                </div>
                <p className="mt-1 text-xs text-zinc-600 sm:text-sm">
                  기준 월 선택 후 영업 CASH FLOW 배율을 적용하면, 해당 월 이후의 조달 후 기말잔액이 연쇄 반영됩니다.
                </p>
                <div className="mt-4 flex flex-wrap gap-4">
                  <div>
                    <label className="block text-xs font-medium text-zinc-600">기준 월</label>
                    <select
                      className="mt-1 rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900"
                      value={simMonthColIndex ?? ""}
                      onChange={(e) => {
                        const v = e.target.value ? Number(e.target.value) : null;
                        setSimSelectedMonthColIndex(Number.isNaN(v) ? null : v);
                      }}
                    >
                      {monthlyColumns.map((m) => (
                        <option key={m.colIndex} value={m.colIndex}>
                          {formatYearMonthLabel(m.label)}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-zinc-600">영업 CASH FLOW 배율</label>
                    <select
                      className="mt-1 rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900"
                      value={simMultiplier}
                      onChange={(e) => setSimMultiplier(Number(e.target.value))}
                    >
                      {[80, 90, 100, 110, 120, 130, 140, 150, 160, 170, 180, 190, 200].map((p) => (
                        <option key={p} value={p}>
                          {p}%
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="mt-6 overflow-x-auto">
                  <table className="min-w-full border-collapse text-sm">
                    <thead>
                      <tr className="border-b border-zinc-200 bg-zinc-50">
                        <th
                          rowSpan={2}
                          className="sticky left-0 z-10 min-w-[8rem] bg-zinc-50 px-3 py-2 text-left font-medium text-zinc-700 align-top"
                        >
                          구분
                        </th>
                        {simulationResults.length > 0 && (
                          <th
                            colSpan={simulationResults.length}
                            className="border-b border-zinc-200 py-2 text-center text-xs font-medium text-zinc-600"
                          >
                            {(() => {
                              const m = simulationResults[0]?.monthLabel.match(/^(\d{4})년/);
                              return m ? `${m[1]}년` : "";
                            })()}
                          </th>
                        )}
                      </tr>
                      <tr className="border-b border-zinc-200 bg-zinc-50">
                        {simulationResults.map((r) => {
                          const m = r.monthLabel.match(/(\d{1,2})월/);
                          const monthLabel = m ? `${parseInt(m[1], 10)}월` : r.monthLabel;
                          return (
                            <th
                              key={r.monthLabel}
                              className={`min-w-[5rem] px-3 py-2 text-right font-medium text-zinc-700 ${
                                r.isSimulated ? "bg-amber-100" : ""
                              }`}
                            >
                              {monthLabel}
                            </th>
                          );
                        })}
                      </tr>
                    </thead>
                    <tbody>
                      {[
                        { key: "기존 기초현금", getVal: (row: SimulationResult) => row.openingCash, isSim: false },
                        { key: "시뮬 기초현금", getVal: (row: SimulationResult) => row.simOpeningCash, isSim: true },
                        { key: "기존 영업 CF", getVal: (row: SimulationResult) => row.operatingCF, isSim: false },
                        { key: "시뮬 영업 CF", getVal: (row: SimulationResult) => row.simOperatingCF, isSim: true },
                        { key: "투자 CF", getVal: (row: SimulationResult) => row.investingCF, isSim: false },
                        { key: "조달 CF", getVal: (row: SimulationResult) => row.financingCF, isSim: false },
                        { key: "기존 조달후기말", getVal: (row: SimulationResult) => row.endingCash, isSim: false },
                        { key: "시뮬 조달후기말", getVal: (row: SimulationResult) => row.simEndingCash, isSim: true },
                        {
                          key: "증감액",
                          getVal: (row: SimulationResult) => row.diff,
                          isDiff: true,
                          isSim: true,
                        },
                      ].map(({ key, getVal, isDiff = false, isSim = false }) => (
                        <tr
                          key={key}
                          className={`border-b border-zinc-100 ${isSim ? "bg-amber-50" : ""}`}
                        >
                          <td
                            className={`sticky left-0 z-[9] min-w-[8rem] px-3 py-2 font-medium ${
                              isSim && simMultiplier !== 100
                                ? "bg-amber-100 text-blue-700 italic"
                                : isSim
                                  ? "bg-amber-100 text-amber-900"
                                  : "bg-white text-zinc-900"
                            }`}
                          >
                            {key}
                          </td>
                          {simulationResults.map((r) => {
                            const v = getVal(r);
                            const str = isDiff
                              ? `${v >= 0 ? "+" : ""}${formatNumberKRInt(v)}`
                              : formatNumberKRInt(v);
                            const isNeg = isDiff && v < 0;
                            const cellBg =
                              r.isSimulated && isSim
                                ? "bg-amber-200"
                                : r.isSimulated
                                  ? "bg-amber-50"
                                  : isSim
                                    ? "bg-amber-50"
                                    : "";
                            const isSimulatedCell = isSim && r.isSimulated && simMultiplier !== 100;
                            const textStyle = isSimulatedCell
                              ? "italic text-blue-700 font-medium"
                              : isNeg
                                ? "text-red-600 font-medium"
                                : "text-zinc-900";
                            return (
                              <td
                                key={r.monthLabel}
                                className={`px-3 py-2 text-right ${cellBg} ${textStyle}`}
                              >
                                {str}
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </section>
          </>
        )}
      </main>
    </div>
  );
}
