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
    <div className="h-screen w-screen bg-background flex items-center justify-center">
      <div className="w-full max-w-sm px-6">
        <div className="mb-10">
          <h1 className="text-[20px] font-bold text-foreground mb-1">Connecting Dots</h1>
          <p className="text-[15px] text-muted-foreground">Organise tes signets X par sujet</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="api-key" className="block text-[13px] text-muted-foreground mb-1.5">
              Clef API Anthropic
            </label>
            <input
              id="api-key"
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="sk-ant-..."
              className="w-full px-3 py-2.5 bg-secondary border border-border rounded-lg text-foreground placeholder-muted-foreground focus:outline-none focus:ring-1 focus:ring-[#1d9bf0] focus:bg-background transition-all font-mono text-[14px]"
              autoFocus
            />
          </div>

          {error && <p className="text-[#f4212e] text-[13px]">{error}</p>}

          <button
            type="submit"
            disabled={loading || !apiKey.trim()}
            className="w-full py-2.5 bg-foreground text-background rounded-full font-bold text-[15px] hover:opacity-90 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          >
            {loading ? "Connexion..." : "Commencer"}
          </button>

          <p className="text-muted-foreground text-[13px] text-center">
            Ta clef reste sur ta machine.
          </p>
        </form>
      </div>
    </div>
  );
}
