import type { User } from '../types'

const ROLE_LABELS: Record<string, string> = {
  admin:      'Адміністратор',
  brigadir:   'Бригадир',
  controller: 'Контролер',
}

const ROLE_COLORS: Record<string, string> = {
  admin:      'bg-purple-100 text-purple-700',
  brigadir:   'bg-blue-100 text-blue-700',
  controller: 'bg-green-100 text-green-700',
}

interface Props {
  user: User
}

export function UserCard({ user }: Props) {
  const initials = user.name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 flex items-center gap-4">
      <div className="w-12 h-12 rounded-xl bg-blue-600 flex items-center justify-center text-white font-bold text-lg flex-shrink-0">
        {initials}
      </div>
      <div className="flex-1 min-w-0">
        <p className="font-semibold text-gray-900 truncate">{user.name}</p>
        <span className={`inline-block text-xs font-medium px-2 py-0.5 rounded-full mt-0.5 ${ROLE_COLORS[user.role]}`}>
          {ROLE_LABELS[user.role]}
        </span>
      </div>
    </div>
  )
}
