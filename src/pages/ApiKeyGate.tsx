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
    <div className="h-screen w-screen bg-zinc-50 flex items-center justify-center">
      <div className="w-full max-w-sm px-6">
        <div className="mb-10">
          <h1 className="text-lg font-semibold tracking-tight text-zinc-900 mb-1">
            Connecting Dots
          </h1>
          <p className="text-[13px] text-zinc-500">
            Ton deuxième cerveau, branché sur X
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="api-key" className="block text-[12px] text-zinc-500 mb-1.5 font-medium">
              Clé API Anthropic
            </label>
            <input
              id="api-key"
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="sk-ant-..."
              className="w-full px-3 py-2 bg-zinc-50 border border-zinc-200 rounded-md text-zinc-900 placeholder-zinc-400 focus:outline-none focus:bg-white focus:border-violet-600 focus:ring-1 focus:ring-violet-600/20 transition-all font-mono text-[13px]"
              autoFocus
            />
          </div>

          {error && <p className="text-red-500 text-[12px]">{error}</p>}

          <button
            type="submit"
            disabled={loading || !apiKey.trim()}
            className="w-full py-2 bg-zinc-900 text-white rounded-md font-medium text-[13px] hover:bg-zinc-800 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          >
            {loading ? "Connexion..." : "Démarrer"}
          </button>

          <p className="text-zinc-400 text-[11px] text-center pt-1">
            Ta clé reste locale. Elle ne quitte jamais ta machine.
          </p>
        </form>
      </div>
    </div>
  );
}
