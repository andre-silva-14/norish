// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

import { trpcLogger } from "@norish/shared-server/logger";
import { storesProcedures } from "@norish/trpc/routers/stores/stores";

import { assertHouseholdAccess } from "../mocks/permissions";
import { createMockAuthedContext, createMockHousehold, createMockUser } from "../calendar/test-utils";

const storesRepository = vi.hoisted(() => ({
  checkStoreNameExistsInHousehold: vi.fn(),
  countGroceriesInStore: vi.fn(),
  createStore: vi.fn(),
  deleteStore: vi.fn(),
  getStoreOwnerId: vi.fn(),
  listStoresByUserIds: vi.fn(),
  reorderStores: vi.fn(),
  updateStore: vi.fn(),
}));

const storeEmitter = vi.hoisted(() => ({
  emitToHousehold: vi.fn(),
}));

const groceryEmitter = vi.hoisted(() => ({
  emitToHousehold: vi.fn(),
}));

vi.mock("@norish/db/repositories/stores", () => storesRepository);
vi.mock("@norish/auth/permissions", () => import("../mocks/permissions"));
vi.mock("@norish/trpc/routers/stores/emitter", () => ({ storeEmitter }));
vi.mock("@norish/trpc/routers/groceries/emitter", () => ({ groceryEmitter }));
vi.mock("@norish/shared-server/logger", () => ({
  trpcLogger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

describe("stores procedures", () => {
  const user = createMockUser();
  const household = createMockHousehold();
  const ctx = createMockAuthedContext(user, household);

  beforeEach(() => {
    vi.clearAllMocks();
    storesRepository.getStoreOwnerId.mockResolvedValue(ctx.user.id);
    assertHouseholdAccess.mockResolvedValue(undefined);
  });

  it("logs stale store updates as no-ops", async () => {
    storesRepository.updateStore.mockResolvedValue(null);

    const caller = storesProcedures.createCaller({ ...ctx, multiplexer: null } as any);
    const result = await caller.update({
      id: crypto.randomUUID(),
      version: 3,
      name: "Pantry",
    });

    expect(result).toBeDefined();
    expect(trpcLogger.info).toHaveBeenCalledWith(
      { userId: ctx.user.id, storeId: result, version: 3 },
      "Ignoring stale store update mutation"
    );
    expect(storeEmitter.emitToHousehold).not.toHaveBeenCalled();
  });

  it("logs stale store reorders as no-ops", async () => {
    const storeId = crypto.randomUUID();

    storesRepository.reorderStores.mockResolvedValue([]);

    const caller = storesProcedures.createCaller({ ...ctx, multiplexer: null } as any);
    const result = await caller.reorder({ stores: [{ id: storeId, version: 2 }] });

    expect(result).toEqual([storeId]);
    expect(trpcLogger.info).toHaveBeenCalledWith(
      { userId: ctx.user.id, requestedStoreCount: 1 },
      "Ignoring stale store reorder mutation"
    );
    expect(storeEmitter.emitToHousehold).not.toHaveBeenCalled();
  });

  it("logs partial store reorders and emits only applied stores", async () => {
    const storeA = crypto.randomUUID();
    const storeB = crypto.randomUUID();
    const reorderedStore = { id: storeA, name: "Pantry", color: "primary", icon: "Cart", sortOrder: 0, version: 3 };

    storesRepository.reorderStores.mockResolvedValue([reorderedStore]);

    const caller = storesProcedures.createCaller({ ...ctx, multiplexer: null } as any);
    const result = await caller.reorder({
      stores: [
        { id: storeA, version: 1 },
        { id: storeB, version: 4 },
      ],
    });

    expect(result).toEqual([storeA, storeB]);
    expect(trpcLogger.info).toHaveBeenCalledWith(
      { userId: ctx.user.id, requestedStoreCount: 2, appliedStoreCount: 1 },
      "Store reorder partially applied due to stale versions"
    );
    expect(storeEmitter.emitToHousehold).toHaveBeenCalledWith(ctx.householdKey, "reordered", {
      stores: [reorderedStore],
    });
  });
});
