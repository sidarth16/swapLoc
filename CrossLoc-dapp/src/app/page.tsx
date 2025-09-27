"use client"

import { useEffect, useState, useRef } from "react"


type LogLine = {
  type: "log" | "error"
  message: string
}


export default function Home() {
  const [srcChain, setSrcChain] = useState("POLYGON")
  const [dstChain, setDstChain] = useState("STRK")
  const [srcToken, setSrcToken] = useState("")
  const [dstToken, setDstToken] = useState("")
  const [amountSrc, setAmountSrc] = useState("")
  const [amountDst, setAmountDst] = useState("")
  const [logs, setLogs] = useState<LogLine[]>([])
  const [loading, setLoading] = useState(false)

  const [walletAddress, setWalletAddress] = useState<string | null>(null)

  const logsEndRef = useRef<HTMLDivElement | null>(null)

  // Capture console.log & console.error
  useEffect(() => {
    const originalLog = console.log
    const originalError = console.error

    console.log = (...args: any[]) => {
      setLogs(prev => [...prev, { type: "log", message: args.join(" ") }])
      originalLog(...args)
    }

    console.error = (...args: any[]) => {
      setLogs(prev => [...prev, { type: "error", message: args.join(" ") }])
      originalError(...args)
    }

    return () => {
      console.log = originalLog
      console.error = originalError
    }
  }, [])

  // Auto-scroll to bottom on new logs
  useEffect(() => {
    if (logsEndRef.current) {
      logsEndRef.current.scrollIntoView({ behavior: "smooth" })
    }
  }, [logs])


  async function handleSwap() {
    setLogs([])
    setLoading(true)

    try {

      let swap
      let evmUserAddress
      let strkUserAddress

      if (srcChain === "POLYGON" && dstChain === "STRK") {
        const { swapEVMtoStarknet } = await import("@/lib/swapEVMtoStarknet-Metamask")
        swap = new swapEVMtoStarknet()
        evmUserAddress = await swap.initUserWallet(); // 🔥 triggers MetaMask connect
        strkUserAddress = "0x03cd91c0ace43f0b8cb28c970c23cf8f05d0adcf37bd9108b0ca377868242453"
      } 
      
      else if (srcChain === "STRK" && dstChain === "POLYGON") {
        const { swapStarknetToEVM } = await import("@/lib/swapStarknettoEVM-Braavos")
        swap = new swapStarknetToEVM()
        strkUserAddress = "0x03cd91c0ace43f0b8cb28c970c23cf8f05d0adcf37bd9108b0ca377868242453"
        evmUserAddress = "0x0D2a7a7A808975dF6e1858772C1cC0A92177D5A9"
      } 

      else if (srcChain === "POLYGON" && dstChain === "KADENA_20") {
        const { swapEVMtoKADENA } = await import("@/lib/swapEVMtoKADENA")
        swap = new swapEVMtoKADENA()
        evmUserAddress = await swap.initUserWallet(); // 🔥 triggers MetaMask connect
        strkUserAddress = "0x0D2a7a7A808975dF6e1858772C1cC0A92177D5A9"
      }

      else if (srcChain === "KADENA_21" && dstChain === "KADENA_20") {
        const { swapKADENAtoKADENA } = await import("@/lib/swapKADENAtoKADENA")
        swap = new swapKADENAtoKADENA()
        evmUserAddress = await swap.initUserWallet(); // 🔥 triggers MetaMask connect
        strkUserAddress = "0x0D2a7a7A808975dF6e1858772C1cC0A92177D5A9"
      }
      
      else {
        console.error(`❌ Unsupported chain pair: ${srcChain} → ${dstChain}`)
        return
      }

      await swap.swapCrossChain(
        srcToken,
        dstToken,
        BigInt(amountSrc),
        BigInt(amountDst),
        evmUserAddress,
        strkUserAddress
      )
    } catch (err: any) {
      console.error("❌ Swap failed:", err.message || err)
    } finally {
      setLoading(false)
    }
  }

  
  return (
    <main className="flex min-h-screen flex-col items-center bg-gradient-to-br from-black via-[#0a0a0a] to-[#111] text-white p-6 font-mono relative overflow-hidden">
  {/* Hacker Glow Overlay */}
  <div className="absolute inset-0 pointer-events-none">
    <div className="w-[400px] h-[400px] bg-green-500/10 rounded-full blur-3xl absolute -top-20 -left-20 animate-pulse" />
    <div className="w-[500px] h-[500px] bg-purple-500/10 rounded-full blur-3xl absolute bottom-0 right-0 animate-pulse" />
  </div>

  {/* Swap Config Section */}
  <div className="w-full max-w-4xl bg-black/70 backdrop-blur-lg rounded-xl p-6 mb-6 shadow-[0_0_20px_rgba(0,255,128,0.2)] border border-green-500/40 relative z-10">
    <h1 className="text-2xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-green-400 via-purple-400 to-pink-400 mb-6 text-center tracking-wide">
      ⚡ CrossLoc : cross-chain-swap
    </h1>

    {/* Inputs */}
    <div className="grid grid-cols-2 gap-6">
      <div className="flex items-center gap-2">
        <select
          className="w-28 rounded bg-black border border-green-500/50 px-2 py-1 text-sm text-green-300 focus:ring-2 focus:ring-green-400 focus:outline-none hover:border-green-300 transition"
          value={srcChain}
          onChange={e => setSrcChain(e.target.value)}
        >
          <option value="POLYGON">POLYGON</option>
          <option value="STRK">STRK</option>
          <option value="KADENA_21">KADENA(21)</option>
        </select>
        <input
          className="flex-1 rounded bg-black border border-green-500/50 px-3 py-2 text-sm text-green-300 placeholder-green-700 focus:ring-2 focus:ring-green-400 hover:border-green-300 transition"
          placeholder="Source Token Address"
          value={srcToken}
          onChange={e => setSrcToken(e.target.value)}
        />
      </div>

      <div className="flex items-center gap-2">
        <input
          className="flex-1 rounded bg-black border border-green-500/50 px-3 py-2 text-sm text-green-300 placeholder-green-700 focus:ring-2 focus:ring-green-400 hover:border-green-300 transition"
          placeholder="Destination Token Address"
          value={dstToken}
          onChange={e => setDstToken(e.target.value)}
        />
        <select
          className="w-28 rounded bg-black border border-green-500/50 px-2 py-1 text-sm text-green-300 focus:ring-2 focus:ring-green-400 focus:outline-none hover:border-green-300 transition"
          value={dstChain}
          onChange={e => setDstChain(e.target.value)}
        >
          <option value="POLYGON">POLYGON</option>
          <option value="STRK">STRK</option>
          <option value="KADENA_20">KADENA(20)</option>
        </select>
      </div>
    </div>

    {/* Amounts */}
    <div className="grid grid-cols-2 gap-6 mt-4">
      <input
        className="rounded bg-black border border-green-500/50 px-3 py-2 text-sm text-green-300 placeholder-green-700 focus:ring-2 focus:ring-green-400 hover:border-green-300 transition"
        placeholder="Source Amount"
        type="number"
        value={amountSrc}
        onChange={e => setAmountSrc(e.target.value)}
      />
      <input
        className="rounded bg-black border border-green-500/50 px-3 py-2 text-sm text-green-300 placeholder-green-700 focus:ring-2 focus:ring-green-400 hover:border-green-300 transition"
        placeholder="Destination Amount"
        type="number"
        value={amountDst}
        onChange={e => setAmountDst(e.target.value)}
      />
    </div>

    {/* Button */}
    <button
      onClick={handleSwap}
      disabled={loading}
      className="mt-6 w-full rounded-lg bg-gradient-to-r from-green-400 to-green-600 py-2 text-sm font-semibold text-black shadow-lg hover:scale-[1.02] hover:from-green-300 hover:to-green-500 disabled:bg-gray-700 disabled:text-gray-400 transition-all"
    >
      {loading ? "Swapping..." : "🚀 Start Swap"}
    </button>
  </div>

  {/* Logs Section */}
  <div className="w-full max-w-5xl flex-1 bg-black/80 rounded-lg p-4 border border-green-500/30 shadow-inner overflow-y-auto text-xs md:text-sm backdrop-blur-md relative z-10">
    {logs.length === 0 ? (
      <p className="text-gray-600 italic">🖥️ Logs will appear here...</p>
    ) : (
      logs.map((line, i) => (
        <div
          key={i}
          className={`tracking-wide whitespace-pre-wrap transition-all ${
            line.type === "error"
              ? "text-red-400 font-bold animate-pulse"
              : "text-green-400"
          }`}
        >
          {line.type === "error" ? "⛔" : "➜"} {line.message}
        </div>
      ))
    )}
    <div ref={logsEndRef} />
  </div>
</main>

  )
}
