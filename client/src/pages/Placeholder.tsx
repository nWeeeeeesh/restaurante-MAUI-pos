interface Props { title: string }

export default function Placeholder({ title }: Props) {
  return (
    <div className="flex flex-col items-center justify-center h-full text-center p-8">
      <div className="w-16 h-16 bg-[#0077B6]/10 rounded-2xl flex items-center justify-center mb-4">
        <span className="text-3xl">🚧</span>
      </div>
      <h2 className="text-lg font-semibold text-[#1E1E2E]">{title}</h2>
      <p className="text-sm text-gray-400 mt-1">Próximamente — Fase 2</p>
    </div>
  )
}
