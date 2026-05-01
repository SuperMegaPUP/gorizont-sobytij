'use client';

interface ParamSliderProps {
  label: string;
  value: number;
  defaultValue: number;
  min: number;
  max: number;
  step: number;
  unit?: string;
  description?: string;
  category: 'primary' | 'advanced' | 'expert';
  onChange: (value: number) => void;
}

export function ParamSlider({
  label,
  value,
  defaultValue,
  min,
  max,
  step,
  unit,
  description,
  category,
  onChange,
}: ParamSliderProps) {
  const isChanged = value !== defaultValue;

  const categoryColors = {
    primary: '',
    advanced: 'bg-blue-900/50 text-blue-400',
    expert: 'bg-red-900/50 text-red-400',
  };

  return (
    <div className="py-3 border-b border-gray-800 last:border-0">
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-2">
          <span className="text-sm text-gray-200 font-medium">{label}</span>
          {category !== 'primary' && (
            <span className={`text-xs px-1.5 py-0.5 rounded ${categoryColors[category]}`}>
              {category === 'advanced' ? 'A' : 'E'}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <span className={`text-sm ${isChanged ? 'text-cyan-400' : 'text-gray-400'}`}>
            {value}
            {unit}
          </span>
          {isChanged && (
            <span className="text-xs text-gray-500">
              (было {defaultValue})
            </span>
          )}
        </div>
      </div>

      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className={`w-full h-1 rounded-lg appearance-none cursor-pointer ${
          isChanged ? 'bg-cyan-600' : 'bg-gray-700'
        }`}
        style={{
          background: `linear-gradient(to right, ${isChanged ? '#0891b2' : '#374151'} 0%, ${isChanged ? '#0891b2' : '#374151'} ${((value - min) / (max - min)) * 100}%, #1f2937 ${((value - min) / (max - min)) * 100}%, #1f2937 100%)`,
        }}
      />

      {description && (
        <p className="text-xs text-gray-500 mt-1">{description}</p>
      )}
    </div>
  );
}