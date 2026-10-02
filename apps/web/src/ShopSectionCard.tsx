import { useMemo, useState } from "react";
import CanvasCard, { CardAdd, CardTitle, type CardFrame } from "./CanvasCard";
import ColorPicker from "./ColorPicker";
import ConfirmPopover from "./ConfirmPopover";
import { ArrowDownIcon, ArrowUpIcon, BagIcon, CircleCheckIcon, FlameIcon, PencilIcon, SparkleIcon } from "./Icons";
import ItemList from "./ItemList";
import Popover from "./Popover";
import RewardItem, { RewardForm } from "./RewardItem";
import { ADD_BUTTON_KEY, addButtonOption } from "./displayOptions";
import { DisplayMenu, SortMenu, tabView, type DisplayOption, type SortOption } from "./TabControls";
import type { Group, Reward, ShopSection } from "./types";
import type { TabPrefs } from "./useLocalConfig";
import type { RewardInput } from "./useShop";

// A shop tab: the same tab base as a board tab (CanvasCard — move/resize, header, sort/display
// controls, add button) around the same list base (ItemList — reorder and grouping). What's specific
// here is only what's specific to rewards: their sorts and display toggles, the reward row, the add
// form, and the tab settings (unlike the board's fixed tabs, shop tabs are renamed and deleted here).

const REWARD_SORT_OPTIONS: SortOption[] = [
  { mode: "manual", label: "Manual", icon: SparkleIcon },
  { mode: "affordable", label: "Can afford first", icon: CircleCheckIcon },
  { mode: "cost-asc", label: "Cost: low to high", icon: ArrowUpIcon },
  { mode: "cost-desc", label: "Cost: high to low", icon: ArrowDownIcon },
  { mode: "bought-desc", label: "Most bought", icon: FlameIcon },
  { mode: "added-newest", label: "Date added: newest", icon: ArrowDownIcon },
  { mode: "added-oldest", label: "Date added: oldest", icon: ArrowUpIcon },
];

// A reward row's optional extras (the Display menu). Both on by default — unlike a task's, they're
// the reward's own details rather than add-on tooling. The "+" is hidden until wanted, as on most tabs.
const REWARD_DISPLAY: DisplayOption[] = [
  { key: "note", label: "Note", icon: PencilIcon, defaultOn: true },
  { key: "bought", label: "Times bought", icon: BagIcon, defaultOn: true },
  addButtonOption("reward"),
];

// Whether a reward can be bought right now. Mirrors the server's own check, only to disable the
// button and drive the "Can afford first" sort; the server still has the final say.
const affordable = (r: Reward, points: number, closed: boolean) => !closed && points >= r.cost;

interface ShopSectionCardProps {
  section: ShopSection;
  rewards: Reward[];
  groups: Group[];
  points: number; // the owner's spendable points (thousandths) — gates the buy buttons
  closed: boolean; // spec: a negative balance closes the shop
  frame: CardFrame;
  prefs: TabPrefs | undefined;
  onPrefsChange: (patch: Partial<TabPrefs>) => void;
  pinnedSorts: string[];
  onTogglePin: (mode: string) => void;
  onEditSection: (patch: Partial<Omit<ShopSection, "id">>) => void;
  onRemoveSection: () => void;
  onAddReward: (input: RewardInput) => void;
  onEditReward: (id: string, input: RewardInput) => void;
  onRemoveReward: (id: string) => void;
  onBuy: (reward: Reward) => void;
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
  frame,
  prefs,
  onPrefsChange,
  pinnedSorts,
  onTogglePin,
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
  const view = tabView(prefs, onPrefsChange, REWARD_DISPLAY);
  const showAddButton = view.shown(ADD_BUTTON_KEY);
  const sortMode = view.sortMode;
  const canBuy = (r: Reward) => affordable(r, points, closed);

  const sorted = useMemo(() => {
    // Affordable first (cheapest first within each band), so what you can have now leads.
    if (sortMode === "affordable") {
      const band = (r: Reward) => Number(!affordable(r, points, closed));
      return [...rewards].sort((a, b) => band(a) - band(b) || a.cost - b.cost);
    }
    if (sortMode === "cost-asc") return [...rewards].sort((a, b) => a.cost - b.cost);
    if (sortMode === "cost-desc") return [...rewards].sort((a, b) => b.cost - a.cost);
    if (sortMode === "bought-desc") return [...rewards].sort((a, b) => b.redeemed - a.redeemed);
    // createdAt is an ISO string, so lexicographic compare is chronological.
    if (sortMode === "added-newest") return [...rewards].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    if (sortMode === "added-oldest") return [...rewards].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    return rewards;
  }, [rewards, sortMode, points, closed]);

  return (
    <CanvasCard
      frame={frame}
      title={
        <CardTitle name={section.name} color={section.color} popoverTitle="Tab" popoverWidth={220}>
          <TabSettings section={section} rewardCount={rewards.length} onEdit={onEditSection} onRemove={onRemoveSection} />
        </CardTitle>
      }
      actions={
        <>
          <SortMenu
            options={REWARD_SORT_OPTIONS}
            mode={sortMode}
            onSelect={view.setSortMode}
            pinned={{ modes: pinnedSorts, onToggle: onTogglePin }}
          />
          <DisplayMenu options={REWARD_DISPLAY} shown={view.shown} onToggle={view.setShown} />
        </>
      }
      footer={
        <CardAdd label="Add reward" shown={showAddButton}>
          {(open, close) => (
            <Popover title="Add reward" open={open} onClose={close} align="left" width={280}>
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
        items={rewards}
        manual={sortMode === "manual"}
        sorted={sorted}
        groups={groups}
        noun="rewards"
        emptyLabel="No rewards yet"
        renderItem={(reward, row) => (
          <RewardItem
            key={reward.id}
            reward={reward}
            color={section.color}
            row={row}
            affordable={canBuy(reward)}
            showNote={view.shown("note")}
            showBought={view.shown("bought")}
            onBuy={() => onBuy(reward)}
            onEdit={(input) => onEditReward(reward.id, input)}
            onRemove={() => onRemoveReward(reward.id)}
          />
        )}
        onReorder={onReorder}
        onAddGroup={onAddGroup}
        onExtendGroup={onExtendGroup}
        onEjectFromGroup={onEjectFromGroup}
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
