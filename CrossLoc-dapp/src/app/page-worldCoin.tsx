"use client"

import { useEffect, useState, useRef } from "react"
import { IDKitWidget, VerificationLevel } from '@worldcoin/idkit'
import type { ISuccessResult } from "@worldcoin/idkit";
import { verify } from "@/lib//verifyProof";


type LogLine = {
  type: "log" | "error"
  message: string
}

// TODO: Calls your implemented server route
const verifyProof = async (result: ISuccessResult) => {
  console.log("Proof received from IDKit, sending to backend:\n", JSON.stringify(result, null, 2));

  const data = await verify({
    nullifier_hash: result.nullifier_hash,
    merkle_root: result.merkle_root,
    proof: result.proof,
    verification_level: result.verification_level,
  });

  if (data.success) {
    console.log("✅ Successful response from backend:\n", JSON.stringify(data, null, 2));
  } else {
    console.error("❌ Verification failed:", JSON.stringify(data, null, 2));
    throw new Error(`Verification failed: ${data.detail || data.code || "Unknown error"}`);
  }
};

// TODO: Functionality after verifying
const onSuccess = (result: ISuccessResult) => {
    // This is where you should perform frontend actions once a user has been verified, such as redirecting to a new page
    window.alert(
      "Successfully verified with World ID! Your nullifier hash is: " +
        result.nullifier_hash
    );
  };

export default function Home() {
  const [srcChain, setSrcChain] = useState("EVM")
  const [dstChain, setDstChain] = useState("STRK")
  const [srcToken, setSrcToken] = useState("")
  const [dstToken, setDstToken] = useState("")
  const [amountSrc, setAmountSrc] = useState("")
  const [amountDst, setAmountDst] = useState("")
  const [logs, setLogs] = useState<LogLine[]>([])
  const [loading, setLoading] = useState(false)

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
      let dstUserAddress

      if (srcChain === "EVM" && dstChain === "STRK") {
        const { swapEVMtoStarknet } = await import("@/lib/swapEVMtoStarknet")
        swap = new swapEVMtoStarknet()
        dstUserAddress = "0x03cd91c0ace43f0b8cb28c970c23cf8f05d0adcf37bd9108b0ca377868242453"
      } else if (srcChain === "STRK" && dstChain === "EVM") {
        const { swapStarknetToEVM } = await import("@/lib/swapStarknettoEVM")
        swap = new swapStarknetToEVM()
        dstUserAddress = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266"
      } else {
        console.error(`❌ Unsupported chain pair: ${srcChain} → ${dstChain}`)
        return
      }

      await swap.swapCrossChain(
        srcToken,
        dstToken,
        BigInt(amountSrc),
        BigInt(amountDst),
        dstUserAddress
      )
    } catch (err: any) {
      console.error("❌ Swap failed:", err.message || err)
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="flex min-h-screen flex-col items-center bg-[#0a0a0a] text-white p-6 font-mono">
      <IDKitWidget
    app_id="app_staging_a85d8126aa6cfe943bb8054766b7b8d6"
    action="edorder"
    false
    verification_level={VerificationLevel.Device}
    handleVerify={verifyProof}
    onSuccess={onSuccess}>
    {({ open }) => (
      <button
        onClick={open}
      >
        Verify with World ID
      </button>
    )}
</IDKitWidget>
      {/* Swap Config Section */}
      <div className="w-full max-w-4xl bg-[#111111] rounded-lg p-6 mb-4 shadow-lg border border-green-500/30">
        <h1 className="text-lg font-bold text-green-400 mb-5 text-center">
          ⚡ Cross-chain Swap
        </h1>

        {/* Top Row: Chain + Token Inputs */}
        <div className="grid grid-cols-2 gap-6">
          {/* Source */}
          <div className="flex items-center gap-2">
            <select
              className="w-28 rounded bg-black border border-green-600 px-2 py-1 text-sm text-green-300 focus:outline-none"
              value={srcChain}
              onChange={e => setSrcChain(e.target.value)}
            >
              <option value="EVM">ETH</option>
              <option value="STRK">STRK</option>
            </select>
            <input
              className="flex-1 rounded bg-black border border-green-600 px-2 py-1 text-sm text-green-300 focus:outline-none"
              placeholder="Source Token Address"
              value={srcToken}
              onChange={e => setSrcToken(e.target.value)}
            />
          </div>

          {/* Destination */}
          <div className="flex items-center gap-2">
            <input
              className="flex-1 rounded bg-black border border-green-600 px-2 py-1 text-sm text-green-300 focus:outline-none"
              placeholder="Destination Token Address"
              value={dstToken}
              onChange={e => setDstToken(e.target.value)}
            />
            <select
              className="w-28 rounded bg-black border border-green-600 px-2 py-1 text-sm text-green-300 focus:outline-none"
              value={dstChain}
              onChange={e => setDstChain(e.target.value)}
            >
              <option value="EVM">ETH</option>
              <option value="STRK">STRK</option>
            </select>
          </div>
        </div>

        {/* Amounts Row */}
        <div className="grid grid-cols-2 gap-6 mt-4">
          <input
            className="rounded bg-black border border-green-600 px-2 py-1 text-sm text-green-300 focus:outline-none"
            placeholder="Source Amount"
            type="number"
            value={amountSrc}
            onChange={e => setAmountSrc(e.target.value)}
          />
          <input
            className="rounded bg-black border border-green-600 px-2 py-1 text-sm text-green-300 focus:outline-none"
            placeholder="Destination Amount"
            type="number"
            value={amountDst}
            onChange={e => setAmountDst(e.target.value)}
          />
        </div>

        {/* Swap Button */}
        <button
          onClick={handleSwap}
          disabled={loading}
          className="mt-6 w-full rounded bg-green-600 py-2 text-sm font-semibold text-black hover:bg-green-500 disabled:bg-gray-500"
        >
          {loading ? "Swapping..." : "🚀 Start Swap"}
        </button>
      </div>

      {/* Logs Section */}
      <div className="w-full max-w-5xl flex-1 bg-black rounded-lg p-4 border border-green-600/50 shadow-inner overflow-y-auto text-xs md:text-sm">
        {logs.length === 0 ? (
          <p className="text-gray-500">🖥️ Logs will appear here...</p>
        ) : (
          logs.map((line, i) => (
            <div
              key={i}
              className={`tracking-wide whitespace-pre-wrap ${
                line.type === "error" ? "text-red-400 font-bold" : "text-green-400"
              }`}
            >
              {line.type === "error" ? "⛔" : ">"} {line.message}
            </div>
          ))
        )}
        <div ref={logsEndRef} />
      </div>
    </main>
  )
}
