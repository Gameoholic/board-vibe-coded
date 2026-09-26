import { PALETTE } from "./palette";

interface ColorPickerProps {
  value: string;
  onChange: (color: string) => void;
}

function ColorPicker({ value, onChange }: ColorPickerProps) {
  return (
    <div className="color-picker">
      {PALETTE.map((color) => (
        <button
          key={color}
          type="button"
          className={`color-swatch${value.toLowerCase() === color ? " active" : ""}`}
          style={{ background: color }}
          aria-label={`Use color ${color}`}
          onClick={() => onChange(color)}
        />
      ))}
      <label className="color-swatch custom" style={{ background: value }}>
        <input
          type="color"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          aria-label="Custom color"
        />
      </label>
    </div>
  );
}

export default ColorPicker;
