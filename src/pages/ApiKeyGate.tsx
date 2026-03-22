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
    <div className="h-screen w-screen bg-neutral-950 flex items-center justify-center">
      <div className="w-full max-w-md px-6">
        <div className="mb-12 text-center">
          <h1 className="text-3xl font-bold text-white tracking-tight mb-2">
            Connecting Dots
          </h1>
          <p className="text-neutral-500 text-sm">
            Your second brain, plugged into Twitter/X
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label
              htmlFor="api-key"
              className="block text-sm text-neutral-400 mb-2"
            >
              Anthropic API Key
            </label>
            <input
              id="api-key"
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="sk-ant-..."
              className="w-full px-4 py-3 bg-neutral-900 border border-neutral-800 rounded-lg text-white placeholder-neutral-600 focus:outline-none focus:border-neutral-600 transition-colors font-mono text-sm"
              autoFocus
            />
          </div>

          {error && (
            <p className="text-red-400 text-sm">{error}</p>
          )}

          <button
            type="submit"
            disabled={loading || !apiKey.trim()}
            className="w-full py-3 bg-white text-neutral-950 rounded-lg font-medium text-sm hover:bg-neutral-200 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {loading ? "Connecting..." : "Start"}
          </button>

          <p className="text-neutral-600 text-xs text-center mt-6">
            Your key is stored locally and never leaves your machine.
          </p>
        </form>
      </div>
    </div>
  );
}
