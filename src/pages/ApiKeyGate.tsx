import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { motion } from "framer-motion";

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
    <div className="h-screen w-screen bg-bg flex items-center justify-center">
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        className="w-full max-w-sm px-6"
      >
        <div className="mb-10">
          <h1 className="text-lg font-semibold tracking-tight text-fg mb-1">
            Connecting Dots
          </h1>
          <p className="text-[13px] text-muted-fg">
            Ton deuxieme cerveau, branche sur X
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="api-key" className="block text-xs text-muted-fg mb-1.5 font-medium">
              Cle API Anthropic
            </label>
            <input
              id="api-key"
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="sk-ant-..."
              className="w-full px-3 py-2 bg-card border border-border rounded-md text-fg placeholder-muted-fg focus:outline-none focus:ring-1 focus:ring-ring transition-all font-mono text-[13px]"
              autoFocus
            />
          </div>

          {error && <p className="text-red-400 text-xs">{error}</p>}

          <button
            type="submit"
            disabled={loading || !apiKey.trim()}
            className="w-full py-2 bg-fg text-bg rounded-md font-medium text-[13px] hover:opacity-90 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          >
            {loading ? "Connexion..." : "Demarrer"}
          </button>

          <p className="text-muted-fg text-[11px] text-center pt-1">
            Ta cle reste locale. Elle ne quitte jamais ta machine.
          </p>
        </form>
      </motion.div>
    </div>
  );
}
