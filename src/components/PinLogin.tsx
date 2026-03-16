import { useState, useCallback } from 'react'
import procareMark from '../assets/8E17.png'

interface Props {
  onLogin: (pin: string) => Promise<boolean>
  error: string | null
  loading: boolean
}

export function PinLogin({ onLogin, error, loading }: Props) {
  const [pin, setPin] = useState('')
  const [shake, setShake] = useState(false)

  const handleDigit = useCallback((d: string) => {
    if (pin.length >= 4) return
    const next = pin + d
    setPin(next)
    if (next.length === 4) {
      onLogin(next).then(ok => {
        if (!ok) {
          setShake(true)
          setTimeout(() => setShake(false), 500)
          setPin('')
        }
      })
    }
  }, [pin, onLogin])

  const handleClear = useCallback(() => setPin(''), [])

  const digits = ['1','2','3','4','5','6','7','8','9','','0','⌫']

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        {/* Header */}
        <div className="text-center mb-8">
          <img
            src={procareMark}
            alt="Procare"
            className="h-20 sm:h-24 w-auto mx-auto mb-4"
          />
          <h1 className="text-2xl font-bold text-gray-900">Procare prod</h1>
          <p className="text-gray-500 mt-1 text-sm">Введіть PIN-код для входу</p>
        </div>

        {/* PIN dots */}
        <div className={`flex justify-center gap-4 mb-6 ${shake ? 'animate-shake' : ''}`}>
          {[0,1,2,3].map(i => (
            <div
              key={i}
              className={`w-4 h-4 rounded-full border-2 transition-all duration-150 ${
                pin.length > i
                  ? 'bg-blue-600 border-blue-600 scale-110'
                  : 'bg-white border-gray-300'
              }`}
            />
          ))}
        </div>

        {/* Error */}
        {error && (
          <p className="text-center text-red-500 text-sm mb-4">{error}</p>
        )}

        {/* Keypad */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4">
          <div className="grid grid-cols-3 gap-3">
            {digits.map((d, i) => {
              if (d === '') return <div key={i} />
              const isBackspace = d === '⌫'
              return (
                <button
                  key={i}
                  onClick={() => isBackspace ? handleClear() : handleDigit(d)}
                  disabled={loading}
                  className={`
                    h-16 rounded-xl text-xl font-semibold transition-all duration-100
                    active:scale-95 select-none
                    ${isBackspace
                      ? 'text-gray-400 hover:bg-gray-100 active:bg-gray-200'
                      : 'text-gray-800 hover:bg-gray-50 active:bg-gray-100 border border-gray-100'
                    }
                    disabled:opacity-50
                  `}
                >
                  {loading && d !== '⌫' ? '·' : d}
                </button>
              )
            })}
          </div>
        </div>
      </div>

      <style>{`
        @keyframes shake {
          0%, 100% { transform: translateX(0); }
          25% { transform: translateX(-8px); }
          75% { transform: translateX(8px); }
        }
        .animate-shake { animation: shake 0.4s ease-in-out; }
      `}</style>
    </div>
  )
}
