'use client'

import { MonitorCog, Moon, Sun } from 'lucide-react'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useTheme } from '@/components/theme/theme-provider'
import type { ThemePreference } from '@/lib/theme/theme'
import { cn } from '@/lib/utils'

interface ThemeSelectorProps {
  className?: string
  mobile?: boolean
}

const THEME_OPTIONS: Array<{
  value: ThemePreference
  label: string
  Icon: typeof Sun
}> = [
  { value: 'light', label: 'Claro', Icon: Sun },
  { value: 'dark', label: 'Escuro', Icon: Moon },
  { value: 'system', label: 'Sistema', Icon: MonitorCog },
]

export function ThemeSelector({ className, mobile = false }: ThemeSelectorProps) {
  const { themePreference, setThemePreference } = useTheme()

  return (
    <Select
      value={themePreference}
      onValueChange={(value) => setThemePreference(value as ThemePreference)}
    >
      <SelectTrigger className={cn(mobile ? 'w-full' : 'w-36', className)}>
        <SelectValue placeholder="Tema" />
      </SelectTrigger>
      <SelectContent>
        {THEME_OPTIONS.map((option) => {
          const Icon = option.Icon
          return (
            <SelectItem key={option.value} value={option.value}>
              <div className="flex items-center gap-2">
                <Icon className="h-4 w-4" />
                {option.label}
              </div>
            </SelectItem>
          )
        })}
      </SelectContent>
    </Select>
  )
}

