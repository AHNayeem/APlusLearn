"use client";

import { useRef, useState } from "react";
import { api, qs } from "@/lib/api/client";

/**
 * A province picker's dependent lists (§2, §6, R2.3).
 *
 * The grades and subjects a picker offers belong to the province selected —
 * Ontario's Grade 12 is not British Columbia's — so changing the province
 * reloads both from `/api/curriculum/tree`, which answers from the
 * curriculum collections. A province an administrator adds tomorrow works
 * here with no code change.
 *
 * Seeded with the server-rendered lists for the starting province, so the
 * first paint needs no request. Loading is driven by the change itself
 * rather than an effect, and an older answer never overwrites a newer one.
 */
export function useProvinceCurriculum({ province: initialProvince, grades: initialGrades = [], subjects: initialSubjects = [] }) {
  const [province, setProvinceState] = useState(initialProvince ?? "");
  const [grades, setGrades] = useState(initialGrades);
  const [subjects, setSubjects] = useState(initialSubjects);
  const [loading, setLoading] = useState(false);
  const latest = useRef(0);

  // A server re-render for another URL hands in another province's lists;
  // adopt them during render, as the inputs adopt the URL. Compared by
  // value: a re-render with the same data must not undo the visitor's choice.
  const seedKey = `${initialProvince ?? ""}|${initialGrades.map((g) => g.id).join(",")}`;
  const [seed, setSeed] = useState(seedKey);
  if (seed !== seedKey) {
    setSeed(seedKey);
    setProvinceState(initialProvince ?? "");
    setGrades(initialGrades);
    setSubjects(initialSubjects);
  }

  const setProvince = async (code) => {
    setProvinceState(code);
    const ticket = latest.current + 1;
    latest.current = ticket;
    setLoading(true);
    try {
      const tree = await api.get(`/api/curriculum/tree${qs({ province: code })}`);
      if (latest.current !== ticket) return null;
      setGrades(tree?.grades ?? []);
      setSubjects(tree?.subjects ?? []);
      return tree;
    } catch {
      if (latest.current === ticket) {
        setGrades([]);
        setSubjects([]);
      }
      return null;
    } finally {
      if (latest.current === ticket) setLoading(false);
    }
  };

  return { province, setProvince, grades, subjects, loading };
}
