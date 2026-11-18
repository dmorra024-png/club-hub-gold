import { useEffect, useLayoutEffect } from "react";
/** Publish imperative capabilities with their DOM commit, never a later passive effect. */
export const useCommittedEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;
