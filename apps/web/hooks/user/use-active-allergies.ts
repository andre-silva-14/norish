"use client";

import { createUseActiveAllergies, type UseActiveAllergiesResult } from "@norish/shared-react/hooks";

import { useUserAllergiesQuery } from "./use-user-allergies-query";

import { useHouseholdContext } from "@/context/household-context";

export const useActiveAllergies = createUseActiveAllergies({
  useHouseholdContext,
  useUserAllergiesQuery,
});

export type { UseActiveAllergiesResult };
