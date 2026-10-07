import { formatPercent, POINTS_PER_PERCENT } from "@board/contracts";
import { useRef, useState } from "react";
import ConfirmPopover from "./ConfirmPopover";
import { formatElapsed, minutesOn, writeMinutes } from "./duration";
import Form from "./Form";
import { GAME_ITEM_IDS, GAME_ITEMS } from "./gameItems";
import { BagIcon, TimerIcon } from "./Icons";
import ItemRow, { RowRemove, type RowContext } from "./ItemRow";
import { ModifierLine, ModifierTag } from "./ModifierBadges";
import { lookOf, modifierInk } from "./modifierLooks";
import { dateLabel } from "./periodLabels";
import Popover from "./Popover";
import { deleteAction, editAction } from "./rowActions";
import Stopwatch from "./Stopwatch";
import { dayKeyFor, isBought, listPrice, payout } from "./types";
import type { AppliedModifier, GameItemId, InventoryItem, Reward, RewardKind, Timer } from "./types";
import { useBoardClock } from "./useBoardClock";
import { useClickOutside } from "./useClickOutside";
import type { NewReward, RewardInput } from "./useShop";
import { useStopwatch } from "./useStopwatch";

// One reward in a shop tab, on the shared row base (ItemRow — move/group handles, reorder, grouping).
// Its cells sit in the same four list columns a task row uses — [emoji] [price] [name] [remove] —
// and right-click opens the same actions menu (Edit, Delete), so shop rows read and behave like board
// rows. The price tag is the buy button, in the tab's colour (a task's checkbox counterpart) — or, when a
// modifier changes the price (the weekend sale), in its colour, with the old price struck through and the
// modifier's tag and line beside the name, the way a task shows what it pays.
// A one-time reward asks first, then shows bought for a beat and leaves its shelf (like a one-time task);
// an Item reward says how many of its item you have. A timed reward's price tag is its stopwatch instead: it
// shows what a minute costs — or, with time on the clock, what that time comes to — and its panel is where
// that time is bought.

// How long a one-time reward stays, bought, before it leaves its shelf (cf. TaskItem's RETIRE_EXIT_DELAY).
const BOUGHT_EXIT_DELAY = 0.45;

interface RewardItemProps {
  reward: Reward;
  color: string;
  row: RowContext;
  // What it costs now (a timed reward: for an hour), and the modifiers that make it so (the weekend sale) —
  // as the server will charge.
  price: number;
  modifiers: AppliedModifier[];
  // Whether there are the points for a price, and the shop is open.
  affords: (price: number) => boolean;
  showNote: boolean;
  showBought: boolean;
  // An Item reward's item: how many of it you have (bought, and the week's free ones).
  held?: InventoryItem;
  // At the price shown — a timed reward's, for that many minutes.
  onBuy: (price: number, minutes?: number) => void;
  onTimer: (timer: Timer | null) => void;
  onEdit: (input: RewardInput) => void;
  onRemove: () => void;
}

function RewardItem({ reward, color, row, price, modifiers, affords, showNote, showBought, held, onBuy, onTimer, onEdit, onRemove }: RewardItemProps) {
  const [editOpen, setEditOpen] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [confirmingBuy, setConfirmingBuy] = useState(false);
  // A one-time reward just bought leaves its shelf with the props it had before, so it says so itself.
  const [leaving, setLeaving] = useState(false);
  const editRef = useRef<HTMLDivElement>(null);
  useClickOutside(editRef, () => setEditOpen(false), editOpen);
  const { settings } = useBoardClock();

  const bought = leaving || isBought(reward);
  const looks = bought ? [] : modifiers.flatMap((m) => lookOf(m) ?? []);
  const ink = bought ? undefined : modifierInk(modifiers);
  const boughtOn = isBought(reward) && reward.boughtAt ? dateLabel(dayKeyFor(reward.boughtAt, settings)) : null;

  // A timed reward's stopwatch. With time on it, the row prices that time; until then, its rate.
  const watch = useStopwatch(reward.timed ? reward.timer : undefined, onTimer);
  const minutes = minutesOn(watch.elapsedMs);
  const listed = minutes > 0 ? listPrice(reward, minutes) : reward.cost;
  const due = minutes > 0 ? payout(listed, modifiers) : price;
  const tagStyle = { "--task-color": color, ...(ink ? { "--ink": ink } : {}) } as React.CSSProperties;

  function buy() {
    if (reward.kind === "once") setConfirmingBuy(true);
    else onBuy(price);
  }

  return (
    <ItemRow
      value={reward}
      id={reward.id}
      row={row}
      className={`reward-item${bought ? " bought" : ""}`}
      exitDelay={leaving ? BOUGHT_EXIT_DELAY : undefined}
      actions={[[editAction(() => setEditOpen(true))], [deleteAction(() => setRemoving(true))]]}
    >
      <span className="reward-emoji" aria-hidden="true">
        {reward.emoji}
      </span>
      {reward.timed ? (
        <Stopwatch
          watch={watch}
          color={color}
          className="shop-timer"
          align="left"
          trigger={(toggle) => (
            <button
              type="button"
              className={`shop-buy${ink ? " modified" : ""}`}
              style={tagStyle}
              aria-label={
                minutes > 0
                  ? `${reward.name}: ${writeMinutes(minutes)} on the clock, ${formatPercent(due)}`
                  : `${reward.name}: ${formatPercent(due / MINUTES_PER_HOUR)} a minute`
              }
              onClick={toggle}
            >
              {minutes > 0 ? (
                <>
                  {ink && <s className="shop-was">{formatPercent(listed)}</s>}
                  {formatPercent(due)}
                </>
              ) : (
                <>
                  {ink && <s className="shop-was">{formatPercent(listed / MINUTES_PER_HOUR)}</s>}
                  {formatPercent(due / MINUTES_PER_HOUR)}/min
                </>
              )}
            </button>
          )}
        >
          {(close) => (
            <button
              type="button"
              className="btn-primary timer-submit"
              disabled={minutes === 0 || !affords(due)}
              onClick={() => {
                onBuy(due, minutes);
                close();
              }}
            >
              {minutes > 0 ? `Buy ${writeMinutes(minutes)} for ${formatPercent(due)}` : "Buy"}
            </button>
          )}
        </Stopwatch>
      ) : (
        <button
          type="button"
          className={`shop-buy${ink ? " modified" : ""}`}
          style={tagStyle}
          disabled={bought || !affords(price)}
          aria-label={bought ? `${reward.name}, bought` : `Buy ${reward.name} for ${formatPercent(price)}`}
          onClick={buy}
        >
          {ink && <s className="shop-was">{formatPercent(reward.cost)}</s>}
          {bought ? "Bought" : formatPercent(price)}
        </button>
      )}
      <div className="reward-main">
        <span className="reward-name">
          {reward.name}
          {(watch.running || watch.elapsedMs > 0) && (
            <span className={`reward-clock${watch.running ? " running" : ""}`}>
              <TimerIcon size={11} />
              {formatElapsed(watch.elapsedMs)}
            </span>
          )}
          {showBought && reward.kind !== "once" && reward.redeemed > 0 && <span className="reward-redeemed">×{reward.redeemed}</span>}
          {looks.map((look) => (
            <ModifierTag key={look.tag} look={look} />
          ))}
        </span>
        {looks.length > 0 && (
          <span className="modifier-lines">
            {modifiers.map((m) => {
              const look = lookOf(m);
              return look ? <ModifierLine key={m.id} look={look} text={look.line(m, reward.cost)} /> : null;
            })}
          </span>
        )}
        {held && <HeldChips {...held} />}
        {boughtOn && <span className="reward-note">{boughtOn}</span>}
        {showNote && reward.note && <span className="reward-note">{reward.note}</span>}
      </div>
      <RowRemove
        label="Remove reward"
        message={`Remove "${reward.name}"?`}
        confirming={removing}
        onConfirmingChange={setRemoving}
        onConfirm={onRemove}
      />
      <div className="popover-anchor row-edit-anchor" ref={editRef}>
        <Popover title="Edit reward" open={editOpen} onClose={() => setEditOpen(false)} align="right" width={280} scrollable>
          <RewardForm
            initial={reward}
            submitLabel="Save"
            onCancel={() => setEditOpen(false)}
            onSave={(input) => {
              onEdit(input);
              setEditOpen(false);
            }}
          />
        </Popover>
        <ConfirmPopover
          open={confirmingBuy}
          message={`Buy ${reward.name} for ${formatPercent(price)}?`}
          confirmLabel="Buy"
          danger={false}
          onConfirm={() => {
            setConfirmingBuy(false);
            setLeaving(true);
            onBuy(price);
          }}
          onCancel={() => setConfirmingBuy(false)}
        />
      </div>
    </ItemRow>
  );
}

/** What you have of an item, as two chips you tell apart at a glance: the ones you own (bought, kept from
 *  week to week) and the week's free ones. Nothing when you have neither. */
export function HeldChips({ owned, free }: Pick<InventoryItem, "owned" | "free">) {
  if (owned === 0 && free === 0) return null;
  return (
    <span className="held-chips">
      {owned > 0 && (
        <span className="held-chip">
          <BagIcon size={11} />
          {owned} owned
        </span>
      )}
      {free > 0 && <span className="held-chip free">{free} free</span>}
    </span>
  );
}

// A reward's cost is stored, like all point values, as integer thousandths-of-a-percent (never
// floats — see @board/contracts points.ts). The form takes the percent the owner types ("2.5").
const toThousandths = (text: string): number => Math.round(parseFloat(text) * POINTS_PER_PERCENT);

// A timed reward's cost is kept for an hour (so a minute's worth needn't be a whole number of thousandths) but
// typed, and shown, for a minute. Five decimals of a percent a minute bring any hourly cost back exactly.
const MINUTES_PER_HOUR = 60;
const perMinuteText = (hourly: number): string => String(Number((hourly / MINUTES_PER_HOUR / POINTS_PER_PERCENT).toFixed(5)));
const hourlyFromPerMinute = (text: string): number => Math.round(parseFloat(text) * POINTS_PER_PERCENT * MINUTES_PER_HOUR);

const KINDS: { kind: RewardKind; label: string }[] = [
  { kind: "repeatable", label: "Repeatable" },
  { kind: "once", label: "One-time" },
  { kind: "game", label: "Item" },
];

// What a repeatable reward's cost is for: each time it's bought, or a minute of it (a timed reward).
const PAID: { timed: boolean; label: string }[] = [
  { timed: false, label: "Each" },
  { timed: true, label: "Per minute" },
];

// The add/edit form for one reward. A new one picks its kind first (an Item reward, its item — which fills in
// its name and emoji); an existing one keeps its kind. Cost is a percent > 0 (down to a thousandth); name and
// cost gate the save. A repeatable reward's cost is for each time or for a minute of it (a timed reward), and
// the weekend sale takes it unless it's switched off.
export function RewardForm({
  initial,
  submitLabel,
  onSave,
  onCancel,
}: {
  initial?: Reward;
  submitLabel: string;
  onSave: (input: NewReward) => void;
  onCancel: () => void;
}) {
  const [kind, setKind] = useState<RewardKind>(initial?.kind ?? "repeatable");
  const [item, setItem] = useState<GameItemId>(initial?.item ?? GAME_ITEM_IDS[0]);
  const [emoji, setEmoji] = useState(initial?.emoji ?? "🎁");
  const [name, setName] = useState(initial?.name ?? "");
  const [cost, setCost] = useState(initial ? (initial.timed ? perMinuteText(initial.cost) : String(initial.cost / POINTS_PER_PERCENT)) : "");
  const [note, setNote] = useState(initial?.note ?? "");
  const [timed, setTimed] = useState(initial?.timed ?? false);
  // Follows the kind until it's set by hand.
  const [onSale, setOnSale] = useState<boolean | null>(initial?.onSale ?? null);
  const perMinute = kind === "repeatable" && timed;
  const costValue = perMinute ? hourlyFromPerMinute(cost) : toThousandths(cost);
  const valid = name.trim() !== "" && Number.isInteger(costValue) && costValue > 0;

  // Picking an item names a new reward after it, unless it's been named already.
  function pickItem(next: GameItemId) {
    const named = name.trim() !== "" && !GAME_ITEM_IDS.some((id) => GAME_ITEMS[id].label === name.trim());
    setItem(next);
    if (!named) {
      setName(GAME_ITEMS[next].label);
      setEmoji(GAME_ITEMS[next].emoji);
    }
  }

  return (
    <Form
      className="popover-form"
      onSubmit={(e) => {
        e.preventDefault();
        if (!valid) return;
        onSave({
          kind,
          ...(kind === "game" ? { item } : {}),
          emoji: emoji.trim() || "🎁",
          name: name.trim(),
          cost: costValue,
          note: note.trim() || undefined,
          onSale: onSale ?? kind === "repeatable",
          timed: perMinute,
        });
      }}
    >
      {!initial && (
        <div className="seg reward-kind" role="radiogroup" aria-label="Kind">
          {KINDS.map((k) => (
            <button
              key={k.kind}
              type="button"
              role="radio"
              aria-checked={kind === k.kind}
              className={`seg-btn${kind === k.kind ? " active" : ""}`}
              onClick={() => {
                setKind(k.kind);
                if (k.kind === "game") pickItem(item);
              }}
            >
              {k.label}
            </button>
          ))}
        </div>
      )}
      {!initial && kind === "game" && (
        <label className="field">
          <span className="field-label">Gives</span>
          <select value={item} onChange={(e) => pickItem(e.target.value as GameItemId)}>
            {GAME_ITEM_IDS.map((id) => (
              <option key={id} value={id}>
                {GAME_ITEMS[id].label}
              </option>
            ))}
          </select>
        </label>
      )}
      <div className="field">
        <span className="field-label">Reward</span>
        <div className="reward-form-name">
          <input type="text" className="reward-form-emoji" value={emoji} maxLength={2} aria-label="Emoji" onChange={(e) => setEmoji(e.target.value)} />
          <input type="text" placeholder="Name" aria-label="Name" value={name} autoFocus onChange={(e) => setName(e.target.value)} />
        </div>
      </div>
      <div className="field">
        <span className="field-label">Cost</span>
        <div className="reward-form-cost">
          <input type="number" min={0} step="any" placeholder="0" aria-label="Cost" value={cost} onChange={(e) => setCost(e.target.value)} />
          <span>%</span>
          {kind === "repeatable" && (
            <div className="seg" role="radiogroup" aria-label="Paid">
              {PAID.map((p) => (
                <button
                  key={p.label}
                  type="button"
                  role="radio"
                  aria-checked={timed === p.timed}
                  className={`seg-btn${timed === p.timed ? " active" : ""}`}
                  onClick={() => setTimed(p.timed)}
                >
                  {p.label}
                </button>
              ))}
            </div>
          )}
        </div>
        {perMinute && <span className="field-hint">Time it, and pay for the minutes it took.</span>}
      </div>
      <label className="field field-toggle">
        <span className="field-label">Weekend sale</span>
        <input
          type="checkbox"
          className="settings-switch"
          checked={onSale ?? kind === "repeatable"}
          onChange={(e) => setOnSale(e.target.checked)}
        />
      </label>
      <label className="field">
        <span className="field-label">Note (optional)</span>
        <textarea className="field-textarea" rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
      </label>
      <div className="popover-actions">
        <button type="button" className="ghost-btn" onClick={onCancel}>
          Cancel
        </button>
        <button type="submit" className="btn-primary" disabled={!valid}>
          {submitLabel}
        </button>
      </div>
    </Form>
  );
}

export default RewardItem;
