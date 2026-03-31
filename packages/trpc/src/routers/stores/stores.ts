import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { assertHouseholdAccess } from "@norish/auth/permissions";
import {
  checkStoreNameExistsInHousehold,
  countGroceriesInStore,
  createStore,
  deleteStore,
  getStoreOwnerId,
  listStoresByUserIds,
  reorderStores,
  updateStore,
} from "@norish/db/repositories/stores";
import { trpcLogger as log } from "@norish/shared-server/logger";
import {
  StoreCreateSchema,
  StoreDeleteSchema,
  StoreReorderSchema,
  StoreUpdateInputSchema,
} from "@norish/shared/contracts/zod";

import { authedProcedure } from "../../middleware";
import { router } from "../../trpc";
import { groceryEmitter } from "../groceries/emitter";

import { storeEmitter } from "./emitter";

const list = authedProcedure.query(async ({ ctx }) => {
  log.debug({ userId: ctx.user.id }, "Listing stores");

  const stores = await listStoresByUserIds(ctx.userIds);

  log.debug({ userId: ctx.user.id, storeCount: stores.length }, "Stores listed");

  return stores;
});

const create = authedProcedure.input(StoreCreateSchema).mutation(async ({ ctx, input }) => {
  const storeId = crypto.randomUUID();

  log.info({ userId: ctx.user.id, storeName: input.name }, "Creating store");

  // Check for duplicate name in household
  const exists = await checkStoreNameExistsInHousehold(input.name, ctx.userIds);

  if (exists) {
    throw new TRPCError({
      code: "CONFLICT",
      message: "A store with this name already exists",
    });
  }

  const storeData = {
    userId: ctx.user.id,
    name: input.name,
    color: input.color ?? "primary",
    icon: input.icon ?? "ShoppingBagIcon",
    sortOrder: 0,
  };

  createStore(storeId, storeData)
    .then((createdStore) => {
      log.info({ userId: ctx.user.id, storeId: createdStore.id }, "Store created");
      storeEmitter.emitToHousehold(ctx.householdKey, "created", {
        store: createdStore,
      });
    })
    .catch((err) => {
      log.error({ err, userId: ctx.user.id }, "Failed to create store");
    });

  return storeId;
});

const update = authedProcedure.input(StoreUpdateInputSchema).mutation(async ({ ctx, input }) => {
  log.debug({ userId: ctx.user.id, storeId: input.id }, "Updating store");

  // Check ownership
  const ownerId = await getStoreOwnerId(input.id);

  if (!ownerId) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Store not found" });
  }
  await assertHouseholdAccess(ctx.user.id, ownerId);

  // Check for duplicate name if name is being changed
  if (input.name) {
    const exists = await checkStoreNameExistsInHousehold(input.name, ctx.userIds, input.id);

    if (exists) {
      throw new TRPCError({
        code: "CONFLICT",
        message: "A store with this name already exists",
      });
    }
  }

  try {
    const updatedStore = await updateStore(input);

    if (!updatedStore) {
      log.info({ userId: ctx.user.id, storeId: input.id, version: input.version }, "Ignoring stale store update mutation");
      return input.id;
    }

    log.info({ userId: ctx.user.id, storeId: updatedStore.id }, "Store updated");
    storeEmitter.emitToHousehold(ctx.householdKey, "updated", {
      store: updatedStore,
    });
  } catch (err) {
    log.error({ err, userId: ctx.user.id, storeId: input.id }, "Failed to update store");
  }

  return input.id;
});

const remove = authedProcedure.input(StoreDeleteSchema).mutation(async ({ ctx, input }) => {
  const { storeId, version, deleteGroceries, grocerySnapshot } = input;

  log.info({ userId: ctx.user.id, storeId, deleteGroceries, hasSnapshot: !!grocerySnapshot }, "Deleting store");

  // Check ownership
  const ownerId = await getStoreOwnerId(storeId);

  if (!ownerId) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Store not found" });
  }
  await assertHouseholdAccess(ctx.user.id, ownerId);

  deleteStore(storeId, version, deleteGroceries, grocerySnapshot)
    .then(({ deletedGroceryIds, storeDeleted, stale }) => {
      if (stale) {
        log.info({ userId: ctx.user.id, storeId, version }, "Ignoring stale store delete mutation");
        return;
      }

      log.info(
        { userId: ctx.user.id, storeId, deletedGroceryCount: deletedGroceryIds.length, storeDeleted },
        "Store delete processed"
      );

      if (storeDeleted) {
        // Emit store deleted event
        storeEmitter.emitToHousehold(ctx.householdKey, "deleted", {
          storeId,
          deletedGroceryIds,
        });
      }

      // If groceries were deleted, also emit grocery deleted event
      if (deletedGroceryIds.length > 0) {
        groceryEmitter.emitToHousehold(ctx.householdKey, "deleted", {
          groceryIds: deletedGroceryIds,
        });
      }
    })
    .catch((err) => {
      log.error({ err, userId: ctx.user.id, storeId }, "Failed to delete store");
    });

  return storeId;
});

const reorder = authedProcedure.input(StoreReorderSchema).mutation(async ({ ctx, input }) => {
  const storeUpdates = input.stores;

  log.debug({ userId: ctx.user.id, storeCount: storeUpdates.length }, "Reordering stores");

  try {
    const reorderedStores = await reorderStores(storeUpdates);

    if (reorderedStores.length === 0) {
      log.info({ userId: ctx.user.id, requestedStoreCount: storeUpdates.length }, "Ignoring stale store reorder mutation");
      return storeUpdates.map((s) => s.id);
    }

    if (reorderedStores.length !== storeUpdates.length) {
      log.info(
        {
          userId: ctx.user.id,
          requestedStoreCount: storeUpdates.length,
          appliedStoreCount: reorderedStores.length,
        },
        "Store reorder partially applied due to stale versions"
      );
    } else {
      log.info({ userId: ctx.user.id, storeCount: reorderedStores.length }, "Stores reordered");
    }

    storeEmitter.emitToHousehold(ctx.householdKey, "reordered", {
      stores: reorderedStores,
    });
  } catch (err) {
    log.error({ err, userId: ctx.user.id }, "Failed to reorder stores");
  }

  return storeUpdates.map((s) => s.id);
});

const getGroceryCount = authedProcedure
  .input(z.object({ storeId: z.uuid() }))
  .query(async ({ ctx, input }) => {
    const ownerId = await getStoreOwnerId(input.storeId);

    if (!ownerId) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Store not found" });
    }
    await assertHouseholdAccess(ctx.user.id, ownerId);

    return countGroceriesInStore(input.storeId);
  });

export const storesProcedures = router({
  list,
  create,
  update,
  delete: remove,
  reorder,
  getGroceryCount,
});
