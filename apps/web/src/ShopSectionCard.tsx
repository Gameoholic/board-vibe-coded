import { useMemo, useState } from "react";
import CanvasCard, { CardAdd, CardTitle, type CardFrame } from "./CanvasCard";
import ColorPicker from "./ColorPicker";
import ConfirmPopover from "./ConfirmPopover";
import ItemList from "./ItemList";
import Popover from "./Popover";
import RewardItem, { RewardForm } from "./RewardItem";
import { tabInk } from "./palette";
import { DisplayMenu, SortMenu, sortItems, tabView } from "./TabControls";
import { ADD_BUTTON_KEY, GROUPING_KEY, canAfford, shopTabOffer } from "./tabViews";
import { isBought, payout, priceModifiersOf } from "./types";
import type { AppliedModifier, Group, InventoryItem, Reward, ShopSection } from "./types";
import { useBoardClock } from "./useBoardClock";
import type { TabPrefs } from "./useLocalConfig";
import type { NewReward, RewardInput } from "./useShop";

// A shop tab: the same tab base as a board tab (CanvasCard — move/resize, header, sort/display
// controls, add button) around the same list base (ItemList — reorder and grouping). What's specific
// here is only what's specific to rewards: the reward row, the add form, and the tab settings (unlike the
// board's fixed tabs, shop tabs are renamed and deleted here). What its menus offer is tabViews.ts's.

// A reward as it's priced now: what it costs, and the modifiers that make it so (the weekend sale).
interface Priced {
  price: number;
  modifiers: AppliedModifier[];
}

interface ShopSectionCardProps {
  section: ShopSection;
  rewards: Reward[];
  groups: Group[];
  points: number; // the owner's spendable points (thousandths) — gates the buy buttons
  closed: boolean; // spec: a negative balance closes the shop
  inventory: InventoryItem[]; // how many of each item the owner has
  saleStarted: boolean; // the weekend sale was started early this week
  frame: CardFrame;
  prefs: TabPrefs | undefined;
  onPrefsChange: (patch: Partial<TabPrefs>) => void;
  onEditSection: (patch: Partial<Omit<ShopSection, "id">>) => void;
  onRemoveSection: () => void;
  onAddReward: (input: NewReward) => void;
  onEditReward: (id: string, input: RewardInput) => void;
  onRemoveReward: (id: string) => void;
  onBuy: (reward: Reward, price: number) => void;
  onReorder: (orderedIds: string[]) => void;
  onAddGroup: (rewardIds: string[]) => void;
  onExtendGroup: (groupId: string, rewardIds: string[]) => void;
  onEjectFromGroup: (rewardId: string, groupId: string, newOrder: string[]) => void;
  onEditGroup: (id: string, label: string) => void;
  onRemoveGroup: (id: string) => void;
}

function ShopSectionCard({
  section,
  rewards,
  groups,
  points,
  closed,
  inventory,
  saleStarted,
  frame,
  prefs,
  onPrefsChange,
  onEditSection,
  onRemoveSection,
  onAddReward,
  onEditReward,
  onRemoveReward,
  onBuy,
  onReorder,
  onAddGroup,
  onExtendGroup,
  onEjectFromGroup,
  onEditGroup,
  onRemoveGroup,
}: ShopSectionCardProps) {
  const hasOnce = rewards.some((r) => r.kind === "once");
  const offered = useMemo(() => shopTabOffer(hasOnce), [hasOnce]);
  const view = tabView(prefs, onPrefsChange, offered);
  const showAddButton = view.shown(ADD_BUTTON_KEY);
  const showOwned = view.shown("owned");

  // What each reward costs now, as the server will charge it. The board clock ticks each minute, so the
  // weekend sale starts and ends on screen without a reload.
  const { now, settings, openDay } = useBoardClock();
  const priced = useMemo(() => {
    const byId = new Map<string, Priced>();
    for (const r of rewards) {
      const modifiers = priceModifiersOf(r, { settings, now, openDay, startedEarly: saleStarted });
      byId.set(r.id, { price: payout(r.cost, modifiers), modifiers });
    }
    return byId;
  }, [rewards, settings, now, openDay, saleStarted]);
  const priceOf = (r: Reward) => priced.get(r.id)?.price ?? r.cost;

  // A bought one-time reward has left its shelf (the server keeps it at the end of the tab's order) —
  // unless the tab's Display shows them, as a flat look-back that doesn't reorder or group.
  const listed = useMemo(() => rewards.filter((r) => showOwned || !isBought(r)), [rewards, showOwned]);
  const unlisted = useMemo(() => rewards.filter((r) => !showOwned && isBought(r)).map((r) => r.id), [rewards, showOwned]);
  // A reorder names the whole tab: the hidden bought ones keep their place at its end.
  const reorder = (orderedIds: string[]) => onReorder([...orderedIds, ...unlisted]);
  const eject = (rewardId: string, groupId: string, newOrder: string[]) => onEjectFromGroup(rewardId, groupId, [...newOrder, ...unlisted]);

  const sorted = useMemo(
    () =>
      sortItems(listed, offered.sorts.find((o) => o.key === view.sortMode), {
        price: (r: Reward) => priced.get(r.id)?.price ?? r.cost,
        points,
        closed,
      }),
    [listed, offered, view.sortMode, priced, points, closed],
  );

  return (
    <CanvasCard
      frame={frame}
      title={
        <CardTitle name={section.name} color={tabInk(section.color)} popoverTitle="Tab" popoverWidth={220}>
          <TabSettings section={section} rewardCount={rewards.length} onEdit={onEditSection} onRemove={onRemoveSection} />
        </CardTitle>
      }
      actions={
        <>
          <SortMenu options={offered.sorts} view={view} />
          <DisplayMenu options={offered.displays} view={view} />
        </>
      }
      footer={
        <CardAdd label="Add reward" shown={showAddButton}>
          {(open, close) => (
            <Popover title="Add reward" open={open} onClose={close} align="left" width={280} scrollable>
              <RewardForm
                submitLabel="Add reward"
                onCancel={close}
                onSave={(input) => {
                  onAddReward(input);
                  close();
                }}
              />
            </Popover>
          )}
        </CardAdd>
      }
    >
      <ItemList
        items={listed}
        manual={view.sortMode === "manual" && !showOwned}
        sorted={sorted}
        groups={groups}
        noun="rewards"
        emptyLabel="No rewards yet"
        renderItem={(reward, row) => (
          <RewardItem
            key={reward.id}
            reward={reward}
            color={tabInk(section.color)}
            row={row}
            price={priceOf(reward)}
            modifiers={priced.get(reward.id)?.modifiers ?? []}
            affordable={canAfford(priceOf(reward), { points, closed })}
            showNote={view.shown("note")}
            showBought={view.shown("bought")}
            held={reward.item ? inventory.find((i) => i.item === reward.item) : undefined}
            onBuy={() => onBuy(reward, priceOf(reward))}
            onEdit={(input) => onEditReward(reward.id, input)}
            onRemove={() => onRemoveReward(reward.id)}
          />
        )}
        grouping={view.shown(GROUPING_KEY)}
        onReorder={reorder}
        onAddGroup={onAddGroup}
        onExtendGroup={onExtendGroup}
        onEjectFromGroup={eject}
        onEditGroup={onEditGroup}
        onRemoveGroup={onRemoveGroup}
      />
    </CanvasCard>
  );
}

// A shop tab's settings (behind its title): rename (commits on blur/Enter), recolour, and delete —
// confirmed, since it takes the tab's rewards with it.
function TabSettings({
  section,
  rewardCount,
  onEdit,
  onRemove,
}: {
  section: ShopSection;
  rewardCount: number;
  onEdit: (patch: Partial<Omit<ShopSection, "id">>) => void;
  onRemove: () => void;
}) {
  const [name, setName] = useState(section.name);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const commit = () => {
    const trimmed = name.trim();
    if (trimmed && trimmed !== section.name) onEdit({ name: trimmed });
    else setName(section.name);
  };

  return (
    <div className="popover-form">
      <label className="field">
        <span className="field-label">Name</span>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
          }}
        />
      </label>
      <div className="field">
        <span className="field-label">Color</span>
        <ColorPicker value={section.color} onChange={(color) => onEdit({ color })} />
      </div>
      <div className="popover-anchor">
        <button type="button" className="danger-btn" onClick={() => setConfirmOpen(true)}>
          Delete tab
        </button>
        <ConfirmPopover
          open={confirmOpen}
          message={
            rewardCount > 0
              ? `Delete "${section.name}" and its ${rewardCount} reward${rewardCount === 1 ? "" : "s"}?`
              : `Delete "${section.name}"?`
          }
          onConfirm={onRemove}
          onCancel={() => setConfirmOpen(false)}
        />
      </div>
    </div>
  );
}

export default ShopSectionCard;
