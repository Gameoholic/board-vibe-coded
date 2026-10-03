import {
  Reward as RewardSchema,
  Shop as ShopSchema,
  ShopSection as ShopSectionSchema,
  type Reward,
  type Shop,
  type ShopSection,
} from "@board/contracts";
import { useCallback, useEffect, useState } from "react";
import { groupsApi, withMembership, withOrder, withoutGroup } from "./listOps";

// The shop's tabs, their rewards (with list order + groups, exactly like a board tab's tasks) and the
// total spent — server truth, folded from the event log like the rest of the board (see
// ARCHITECTURE.md → "Shop"). Edits apply optimistically and the server stays authoritative; a purchase
// is the one write the server can refuse (it checks affordability itself), so its reply — or, on
// refusal, a fresh read — always replaces the optimistic guess. Order and group operations go through
// the shared list plumbing (listOps), the same the board's tasks use.

// What the edit form changes; a new reward also says what kind it is (set once, like a task's type).
export type RewardInput = Pick<Reward, "emoji" | "name" | "cost" | "note" | "onSale">;
export type NewReward = RewardInput & Pick<Reward, "kind" | "item">;

const EMPTY: Shop = { sections: [], rewards: [], groups: [], spent: 0, inventory: [], saleStarted: false };
// The retired device-local preview's storage key. The owner chose to start fresh when the shop moved
// to the server, so any leftover is simply cleared.
// ponytail: drop this once every device has loaded the app since the move.
const LEGACY_KEY = "board-shop";

const jsonBody = (body: unknown): RequestInit => ({
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

export function useShop() {
  const [shop, setShop] = useState<Shop>(EMPTY);

  const refresh = useCallback(() => {
    fetch("/api/shop")
      .then((res) => res.json())
      .then((data) => setShop(ShopSchema.parse(data)));
  }, []);

  useEffect(() => {
    localStorage.removeItem(LEGACY_KEY);
    refresh();
  }, [refresh]);

  const addSection = useCallback(async (name: string, color: string) => {
    const res = await fetch("/api/shop/sections", { method: "POST", ...jsonBody({ name, color }) });
    const section = ShopSectionSchema.parse(await res.json());
    setShop((prev) => ({ ...prev, sections: [...prev.sections, section] }));
  }, []);

  const editSection = useCallback((id: string, patch: Partial<Omit<ShopSection, "id">>) => {
    setShop((prev) => ({ ...prev, sections: prev.sections.map((s) => (s.id === id ? { ...s, ...patch } : s)) }));
    fetch(`/api/shop/sections/${id}`, { method: "PATCH", ...jsonBody(patch) });
  }, []);

  // Deleting a tab takes its rewards and groups with it (mirrors the server's fold); past spending
  // stays spent.
  const removeSection = useCallback((id: string) => {
    setShop((prev) => ({
      ...prev,
      sections: prev.sections.filter((s) => s.id !== id),
      rewards: prev.rewards.filter((r) => r.shopSectionId !== id),
      groups: prev.groups.filter((g) => g.sectionId !== id),
    }));
    fetch(`/api/shop/sections/${id}`, { method: "DELETE" });
  }, []);

  // `orderedIds` is the tab's full new reward sequence (group members kept contiguous by the block).
  const reorderRewards = useCallback((shopSectionId: string, orderedIds: string[]) => {
    setShop((prev) => ({ ...prev, rewards: withOrder(prev.rewards, orderedIds) }));
    fetch(`/api/shop/sections/${shopSectionId}/reorder`, { method: "PATCH", ...jsonBody({ orderedIds }) });
  }, []);

  // Creating waits for the server's group (it mints the id); the other group edits are optimistic.
  const addGroup = useCallback(async (shopSectionId: string, rewardIds: string[]) => {
    const group = await groupsApi.create(shopSectionId, rewardIds);
    setShop((prev) => ({
      ...prev,
      groups: [...prev.groups, group],
      rewards: withMembership(prev.rewards, rewardIds, group.id),
    }));
  }, []);

  const extendGroup = useCallback((groupId: string, rewardIds: string[]) => {
    setShop((prev) => ({ ...prev, rewards: withMembership(prev.rewards, rewardIds, groupId) }));
    groupsApi.addMembers(groupId, rewardIds);
  }, []);

  const ejectFromGroup = useCallback(
    (shopSectionId: string, rewardId: string, groupId: string, newOrder: string[]) => {
      setShop((prev) => ({ ...prev, rewards: withMembership(prev.rewards, [rewardId], undefined) }));
      reorderRewards(shopSectionId, newOrder);
      groupsApi.removeMembers(groupId, [rewardId]);
    },
    [reorderRewards],
  );

  const editGroup = useCallback((id: string, label: string) => {
    setShop((prev) => ({ ...prev, groups: prev.groups.map((g) => (g.id === id ? { ...g, label } : g)) }));
    groupsApi.relabel(id, label);
  }, []);

  const removeGroup = useCallback((id: string) => {
    setShop((prev) => ({
      ...prev,
      groups: prev.groups.filter((g) => g.id !== id),
      rewards: withoutGroup(prev.rewards, id),
    }));
    groupsApi.remove(id);
  }, []);

  const addReward = useCallback(async (shopSectionId: string, input: NewReward) => {
    const res = await fetch("/api/shop/rewards", { method: "POST", ...jsonBody({ shopSectionId, ...input }) });
    const reward = RewardSchema.parse(await res.json());
    setShop((prev) => ({ ...prev, rewards: [...prev.rewards, reward] }));
  }, []);

  // The edit form always sends every field it edits (a kind is set once); an empty note travels as null so
  // the server clears it.
  const editReward = useCallback((id: string, { emoji, name, cost, note, onSale }: RewardInput) => {
    const patch = { emoji, name, cost, note, onSale };
    setShop((prev) => ({ ...prev, rewards: prev.rewards.map((r) => (r.id === id ? { ...r, ...patch } : r)) }));
    fetch(`/api/shop/rewards/${id}`, { method: "PATCH", ...jsonBody({ ...patch, note: note ?? null }) });
  }, []);

  const removeReward = useCallback((id: string) => {
    setShop((prev) => ({ ...prev, rewards: prev.rewards.filter((r) => r.id !== id) }));
    fetch(`/api/shop/rewards/${id}`, { method: "DELETE" });
  }, []);

  // Optimistic so the points drop lands with the purchase animation; the server's reply reconciles. `price`
  // is what the owner was shown — the server refuses a different one (the sale began or ended meanwhile),
  // and the fresh read then shows the real price. Resolves once the server has answered.
  const buy = useCallback(
    (reward: Reward, price: number): Promise<void> => {
      setShop((prev) => ({
        ...prev,
        spent: prev.spent + price,
        rewards: prev.rewards.map((r) =>
          r.id === reward.id ? { ...r, redeemed: r.redeemed + 1, boughtAt: new Date().toISOString() } : r,
        ),
      }));
      return fetch(`/api/shop/rewards/${reward.id}/purchase`, { method: "POST", ...jsonBody({ price }) })
        .then(async (res) => {
          if (!res.ok) throw new Error(`purchase refused (${res.status})`);
          setShop(ShopSchema.parse(await res.json()));
        })
        .catch(refresh);
    },
    [refresh],
  );

  // Start the weekend sale early, for the rest of the week. The server says no once it's on, so its reply (or
  // a fresh read) is the truth.
  const startSale = useCallback(() => {
    fetch("/api/shop/sale/start", { method: "POST" })
      .then(async (res) => {
        if (!res.ok) throw new Error(`sale refused (${res.status})`);
        setShop(ShopSchema.parse(await res.json()));
      })
      .catch(refresh);
  }, [refresh]);

  return {
    shop,
    startSale,
    addSection,
    editSection,
    removeSection,
    addReward,
    editReward,
    removeReward,
    reorderRewards,
    addGroup,
    extendGroup,
    ejectFromGroup,
    editGroup,
    removeGroup,
    buy,
  };
}

export type ShopApi = ReturnType<typeof useShop>;
