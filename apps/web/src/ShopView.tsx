import { motion } from "framer-motion";
import { useState } from "react";
import CardCanvas from "./CardCanvas";
import { ToolbarGroup } from "./CanvasToolbar";
import Form from "./Form";
import { BagIcon, PlusIcon, TagIcon } from "./Icons";
import { GAME_ITEMS } from "./gameItems";
import { PALETTE } from "./palette";
import { HeldChips } from "./RewardItem";
import ShopSectionCard from "./ShopSectionCard";
import { isBought, saleOn } from "./types";
import type { InventoryItem, Reward } from "./types";
import { useBoardClock } from "./useBoardClock";
import type { LocalConfigApi } from "./useLocalConfig";
import type { ShopApi } from "./useShop";

// Shop mode — not a separate place but a mode of the board's: the board's tabs burst away, the points
// counter docks at the top of the shop's canvas, and that canvas appears in the same frame. It
// is the same canvas base as the board (CardCanvas — free-placed tabs, pan/zoom, grid/snap, reset)
// holding the same tab base (ShopSectionCard on CanvasCard), so every canvas/tab feature is shared.
// Buying spends the board's real points (server-checked); a negative total closes the shop.

// The shop content fades in once the board's burst and the counter's move have had their moment.
const ENTER_DELAY = 0.45;

interface ShopViewProps {
  points: number; // the owner's spendable points (board total + banked − spent), thousandths-of-a-percent
  shop: ShopApi;
  local: LocalConfigApi; // device-local layouts, canvas settings and tab prefs — shared with the board
  onBuy: (reward: Reward, price: number) => void;
}

function ShopView({ points, shop, local, onBuy }: ShopViewProps) {
  const { sections, rewards, groups, inventory, saleStarted } = shop.shop;
  const closed = points < 0; // spec: a negative balance closes the shop
  const { now, settings, openDay } = useBoardClock();
  const sale = saleOn(now, settings, { openDay, startedEarly: saleStarted }) && rewards.some((r) => r.onSale) ? settings.sale : null;
  const addTab = (name: string) => shop.addSection(name, PALETTE[sections.length % PALETTE.length]);

  return (
    <motion.div
      className="shop-layer"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1, transition: { delay: ENTER_DELAY, duration: 0.3 } }}
      exit={{ opacity: 0, transition: { duration: 0.18 } }}
    >
      {sale && (
        <div className="sale-banner">
          <TagIcon size={13} />
          <span>Weekend sale · {sale.percentOff}% off</span>
          <span className="sale-banner-until">until the week ends</span>
        </div>
      )}

      <CardCanvas
        name="shop"
        cards={sections}
        layouts={local.config.layouts}
        onLayoutChange={local.setCardLayout}
        onResetLayouts={local.resetLayouts}
        settings={local.config.settings}
        onSettingsChange={local.setSettings}
        dock
        face={(section) => ({
          name: section.name,
          color: section.color,
          count: rewards.filter((r) => r.shopSectionId === section.id && !isBought(r)).length,
        })}
        shown={local.config.shownTabs.shop}
        onShow={(id) => local.setShownTab("shop", id)}
        toolbar={
          <>
            <ToolbarGroup icon={<BagIcon size={16} />} label="Inventory" title="Inventory" width={280}>
              {() => <Inventory items={inventory} />}
            </ToolbarGroup>
            <ToolbarGroup icon={<PlusIcon size={16} />} label="New shop tab" title="New tab" width={240}>
              {(close) => (
                <NewTabForm
                  onCancel={close}
                  onAdd={(name) => {
                    addTab(name);
                    close();
                  }}
                />
              )}
            </ToolbarGroup>
          </>
        }
        renderCard={(section, frame) => (
          <ShopSectionCard
            key={section.id}
            section={section}
            rewards={rewards.filter((r) => r.shopSectionId === section.id)}
            groups={groups.filter((g) => g.sectionId === section.id)}
            points={points}
            closed={closed}
            inventory={inventory}
            saleStarted={saleStarted}
            frame={frame}
            prefs={local.config.tabPrefs[section.id]}
            onPrefsChange={(patch) => local.setTabPref(section.id, patch)}
            onEditSection={(patch) => shop.editSection(section.id, patch)}
            onRemoveSection={() => shop.removeSection(section.id)}
            onAddReward={(input) => shop.addReward(section.id, input)}
            onEditReward={shop.editReward}
            onRemoveReward={shop.removeReward}
            onBuy={onBuy}
            onReorder={(orderedIds) => shop.reorderRewards(section.id, orderedIds)}
            onAddGroup={(rewardIds) => shop.addGroup(section.id, rewardIds)}
            onExtendGroup={shop.extendGroup}
            onEjectFromGroup={(rewardId, groupId, newOrder) => shop.ejectFromGroup(section.id, rewardId, groupId, newOrder)}
            onEditGroup={shop.editGroup}
            onRemoveGroup={shop.removeGroup}
          />
        )}
      />

      {/* First run: no shelves yet — name the first one right here (later ones: the toolbar's +). */}
      {sections.length === 0 && (
        <div className="shop-empty">
          <p className="settings-note">Your shop is empty. Name a tab to start stocking rewards.</p>
          <NewTabForm onAdd={addTab} />
        </div>
      )}

      {closed && (
        <div className="shop-closed-banner">
          You're in the red. The shop is closed until your points climb back above zero — earn them back.
        </div>
      )}
    </motion.div>
  );
}

// What items you have: each one, with those you bought (kept from week to week) and the week's free
// ones (gone when it ends).
function Inventory({ items }: { items: InventoryItem[] }) {
  return (
    <ul className="inventory">
      {items.map((entry) => (
        <li key={entry.item} className="inventory-item">
          <span className="inventory-emoji" aria-hidden="true">
            {GAME_ITEMS[entry.item].emoji}
          </span>
          <span className="inventory-name">{GAME_ITEMS[entry.item].label}</span>
          {entry.owned > 0 || entry.free > 0 ? <HeldChips {...entry} /> : <span className="inventory-none">None</span>}
        </li>
      ))}
    </ul>
  );
}

// Name a new shop tab (its colour is the next from the palette; change it from the tab's title).
function NewTabForm({ onAdd, onCancel }: { onAdd: (name: string) => void; onCancel?: () => void }) {
  const [name, setName] = useState("");
  return (
    <Form
      className="popover-form"
      onSubmit={(e) => {
        e.preventDefault();
        const trimmed = name.trim();
        if (!trimmed) return;
        onAdd(trimmed);
        setName("");
      }}
    >
      <label className="field">
        <span className="field-label">Tab name</span>
        <input type="text" value={name} autoFocus onChange={(e) => setName(e.target.value)} />
      </label>
      <div className="popover-actions">
        {onCancel && (
          <button type="button" className="ghost-btn" onClick={onCancel}>
            Cancel
          </button>
        )}
        <button type="submit" className="btn-primary" disabled={!name.trim()}>
          Add tab
        </button>
      </div>
    </Form>
  );
}

export default ShopView;
