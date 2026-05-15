import { useEffect, useState } from "react";
import { defaultDepartments } from "../data/departments.js";

const STORAGE_KEY = "fnb.company.departments";

function loadDepartments() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (!saved) return defaultDepartments;
    const parsed = JSON.parse(saved);
    return Array.isArray(parsed) ? parsed : defaultDepartments;
  } catch {
    return defaultDepartments;
  }
}

export function useDepartments() {
  const [departments, setDepartments] = useState(loadDepartments);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(departments));
  }, [departments]);

  return [departments, setDepartments];
}
