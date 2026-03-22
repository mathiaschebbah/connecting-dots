import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";

interface ApiKeyGateProps {
  onAuthenticated: () => void;
}

export function ApiKeyGate({ onAuthenticated }: ApiKeyGateProps) {
  const [apiKey, setApiKey] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!apiKey.trim()) return;

    setLoading(true);
    setError("");

    try {
      await invoke("set_api_key", { apiKey: apiKey.trim() });
      onAuthenticated();
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="h-screen w-screen bg-[#08080c] flex items-center justify-center">
      <div className="w-full max-w-sm px-6">
        <div className="mb-14 text-center">
          <div className="w-12 h-12 rounded-2xl bg-violet-500/10 border border-violet-500/20 flex items-center justify-center mx-auto mb-5">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#a78bfa" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="5" r="2" />
              <circle cx="5" cy="19" r="2" />
              <circle cx="19" cy="19" r="2" />
              <line x1="12" y1="7" x2="5" y2="17" />
              <line x1="12" y1="7" x2="19" y2="17" />
              <line x1="5" y1="19" x2="19" y2="19" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-white/90 tracking-tight mb-1.5">
            Connecting Dots
          </h1>
          <p className="text-[13px] text-white/30">
            Your second brain, plugged into X
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="api-key" className="block text-[12px] text-white/40 mb-2 font-medium">
              Anthropic API Key
            </label>
            <input
              id="api-key"
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="sk-ant-..."
              className="w-full px-4 py-3 bg-white/[0.04] border border-white/[0.08] rounded-xl text-white/90 placeholder-white/15 focus:outline-none focus:border-violet-500/40 transition-all font-mono text-[13px]"
              autoFocus
            />
          </div>

          {error && <p className="text-red-400/80 text-[12px]">{error}</p>}

          <button
            type="submit"
            disabled={loading || !apiKey.trim()}
            className="w-full py-3 bg-violet-500 text-white rounded-xl font-medium text-[13px] hover:bg-violet-400 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
          >
            {loading ? "Connecting..." : "Start"}
          </button>

          <p className="text-white/15 text-[11px] text-center pt-2">
            Your key stays local. Never leaves your machine.
          </p>
        </form>
      </div>
    </div>
  );
}
