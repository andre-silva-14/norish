import React from 'react';

import {
  ImportingRecipePlaceholder,
  RecipeCardSkeleton,
} from '@/components/skeletons/recipe-card-skeleton';
import { SwipeableRecipeListItem } from '@/components/recipes/swipeable-recipe-list-item';
import type { RecipeListRow } from '@/lib/recipes/build-recipe-list-rows';

type RecipeListRowContentProps = {
  row: RecipeListRow;
  onDelete: (id: string) => void;
  onPress: (id: string) => void;
  onToggleFavorite: (id: string) => void;
  isDeleting: boolean;
  canDelete: boolean;
  compactPlaceholder?: boolean;
};

function RecipeListRowContentComponent({
  row,
  onDelete,
  onPress,
  onToggleFavorite,
  isDeleting,
  canDelete,
  compactPlaceholder = false,
}: RecipeListRowContentProps) {
  if (row.type === 'initial-skeleton') {
    return <RecipeCardSkeleton compact={compactPlaceholder} />;
  }

  if (row.type === 'pending-import') {
    return <ImportingRecipePlaceholder compact={compactPlaceholder} />;
  }

  return (
    <SwipeableRecipeListItem
      item={row.recipe}
      onDelete={onDelete}
      onPress={onPress}
      onToggleFavorite={onToggleFavorite}
      isDeleting={isDeleting}
      canDelete={canDelete}
    />
  );
}

export const RecipeListRowContent = React.memo(RecipeListRowContentComponent);
