"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError } from "@/lib/api/client";

/**
 * Run an async function and track loading/error/data so every screen can
 * render a real loading, error and empty state without repeating the wiring
 * (§32).
 *
 * `deps` controls when the immediate call re-runs, the same way a `useEffect`
 * dependency array would.
 */
export function useAsync(fn, deps = [], { immediate = true } = {}) {
  const [state, setState] = useState({
    data: null,
    error: null,
    loading: immediate,
  });

  const mounted = useRef(true);
  const callbackRef = useRef(fn);

  // Kept in an effect rather than assigned during render: a ref write during
  // render is not a pure render and can be discarded by React.
  useEffect(() => {
    callbackRef.current = fn;
  });

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const run = useCallback(async (...args) => {
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const data = await callbackRef.current(...args);
      if (mounted.current) setState({ data, error: null, loading: false });
      return data;
    } catch (error) {
      // An aborted request is not a failure the user should see.
      if (error.name === "AbortError") return undefined;
      if (mounted.current) setState({ data: null, error, loading: false });
      throw error;
    }
  }, []);

  useEffect(() => {
    if (!immediate) return undefined;

    let cancelled = false;
    // Deferred to a microtask so the state update happens after the effect
    // returns, rather than synchronously inside it.
    Promise.resolve().then(() => {
      if (!cancelled) run().catch(() => {});
    });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return { ...state, run, setData: (data) => setState((s) => ({ ...s, data })) };
}

/**
 * Submit handler for forms: tracks pending state and maps server-side
 * validation errors back onto fields.
 */
export function useSubmit(handler, { onSuccess, onError } = {}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(null);
  const [fieldErrors, setFieldErrors] = useState({});

  // Held in a ref so `submit` stays stable even when the handler closes over
  // fresh state on every render.
  const handlerRef = useRef(handler);
  const callbacksRef = useRef({ onSuccess, onError });

  useEffect(() => {
    handlerRef.current = handler;
    callbacksRef.current = { onSuccess, onError };
  });

  const submit = useCallback(async (...args) => {
    setPending(true);
    setError(null);
    setFieldErrors({});

    try {
      const result = await handlerRef.current(...args);
      callbacksRef.current.onSuccess?.(result);
      return result;
    } catch (err) {
      if (err instanceof ApiError) {
        const fields = err.fieldErrors;
        setFieldErrors(fields);
        // A pure validation failure is explained field-by-field, so a banner
        // repeating it would be noise.
        setError(Object.keys(fields).length ? null : err.message);
      } else {
        setError(err.message ?? "Something went wrong. Please try again.");
      }
      callbacksRef.current.onError?.(err);
      return undefined;
    } finally {
      setPending(false);
    }
  }, []);

  const reset = useCallback(() => {
    setError(null);
    setFieldErrors({});
  }, []);

  return { submit, pending, error, fieldErrors, reset };
}
