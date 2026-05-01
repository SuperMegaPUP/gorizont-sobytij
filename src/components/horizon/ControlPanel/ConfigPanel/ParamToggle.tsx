'use client';

interface ParamToggleProps {
  label: string;
  value: boolean;
  description?: string;
  onChange: (value: boolean) => void;
}

export function ParamToggle({ label, value, description, onChange }: ParamToggleProps) {
  return (
    <div className="py-3 border-b border-gray-800 last:border-0">
      <div className="flex items-center justify-between">
        <div>
          <span className="text-sm text-gray-200 font-medium">{label}</span>
          {description && (
            <p className="text-xs text-gray-500 mt-0.5">{description}</p>
          )}
        </div>
        <button
          onClick={() => onChange(!value)}
          className={`relative w-11 h-6 rounded-full transition-colors ${
            value ? 'bg-cyan-600' : 'bg-gray-700'
          }`}
        >
          <span
            className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full transition-transform ${
              value ? 'translate-x-5' : 'translate-x-0'
            }`}
          />
        </button>
      </div>
    </div>
  );
}