import { Camera, ScanFace, Users, View } from 'lucide-react'
import { DIRECTOR_CAMERA_PRESETS } from './directorCameraPresets'

interface Props {
  onApply: (presetId: string) => void
}

const iconFor = (id: string) => {
  if (id === 'portrait') return <ScanFace size={13} />
  if (id === 'dialogue') return <Users size={13} />
  if (id.startsWith('profile')) return <View size={13} />
  return <Camera size={13} />
}

export function DirectorCameraPresetGrid({ onApply }: Props) {
  return (
    <div className="grid grid-cols-2 gap-1.5">
      {DIRECTOR_CAMERA_PRESETS.map((preset) => (
        <button
          key={preset.id}
          onClick={() => onApply(preset.id)}
          className="flex min-w-0 items-center gap-2 rounded-xl border border-white/[0.08] bg-white/[0.03] px-2 py-2 text-left transition-colors hover:border-white/20 hover:bg-white/[0.07] active:scale-[0.98]"
          title={preset.description}
        >
          <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-white/[0.055] text-amber-200/80">{iconFor(preset.id)}</span>
          <span className="min-w-0">
            <span className="block truncate text-[10px] font-medium text-white/70">{preset.label}</span>
            <span className="block truncate text-[8px] text-white/30">{preset.description}</span>
          </span>
        </button>
      ))}
    </div>
  )
}
