import { supabase } from "../lib/supabase";
import { throwSupabaseError } from "./supabaseError";
import { buildMonthlyReportingDataset, buildYearlyFinancialDataset } from "./reportingDatasets";

function malaysiaCurrentPeriod(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kuala_Lumpur", year: "numeric", month: "numeric",
  }).formatToParts(now);
  const value = (type) => Number(parts.find((part) => part.type === type)?.value);
  return { year: value("year"), month: value("month") };
}

async function readMonthlyFinancials(outletId, year, month) {
  const { data, error } = await supabase.rpc("reporting_monthly_outlet_financials", {
    p_outlet_id: outletId, p_year: year, p_month: month,
  });
  throwSupabaseError("reporting.monthly_financials", error);
  return data;
}

async function readMonthlyProductSales(outletId, year, month) {
  const { data, error } = await supabase.rpc("reporting_monthly_outlet_product_sales", {
    p_outlet_id: outletId, p_year: year, p_month: month,
  });
  throwSupabaseError("reporting.monthly_product_sales", error);
  return data;
}

// All Reporting consumers, including the future Poster renderer, must use this
// service rather than querying Reporting source tables from the browser.
export const reportingService = {
  async getMonthlyOutletReport({ outletId, year, month }) {
    const [financialContract, productContract] = await Promise.all([
      readMonthlyFinancials(outletId, year, month),
      readMonthlyProductSales(outletId, year, month),
    ]);
    return buildMonthlyReportingDataset({ financialContract, productContract });
  },

  async getYearlyOutletFinancialReport({ outletId, year, now }) {
    const current = malaysiaCurrentPeriod(now);
    const monthsToRead = year < current.year ? 12 : year === current.year ? current.month : 0;
    const monthlyContracts = await Promise.all(Array.from({ length: monthsToRead }, (_, index) => readMonthlyFinancials(outletId, year, index + 1)));
    return buildYearlyFinancialDataset({
      outlet: monthlyContracts[0]?.outlet ?? { id: outletId },
      year,
      monthlyContracts,
      currentYear: current.year,
      currentMonth: current.month,
    });
  },
};
