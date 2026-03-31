import { createUseActiveAllergies, type UseActiveAllergiesResult } from '@norish/shared-react/hooks';

import { useHouseholdContext } from '@/context/household-context';

import { useUserAllergiesQuery } from './use-user-allergies-query';

export const useActiveAllergies = createUseActiveAllergies({
  useHouseholdContext,
  useUserAllergiesQuery,
});

export type { UseActiveAllergiesResult };
