import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Loader2 } from "lucide-react";

interface Props {
  onAuthenticated: () => void;
}

interface SyncEvent {
  worker: string;
  status: string;
  detail: string | null;
}

export function ApiKeyGate({ onAuthenticated }: Props) {
  const [apiKey, setApiKey] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncStatus, setSyncStatus] = useState<string | null>(null);

  useEffect(() => {
    const unlisten = listen<SyncEvent>("sync:event", (event) => {
      const e = event.payload;
      if (e.worker === "bookmarks" && e.status === "done") {
        if (e.detail) {
          setSyncStatus(e.detail);
        }
        setTimeout(() => onAuthenticated(), 800);
      }
      if (e.worker === "enricher" && e.status === "done") {
        setSyncStatus("Dots organisés");
      }
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, [onAuthenticated]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!apiKey.trim()) return;
    setLoading(true);
    setError("");
    try {
      await invoke("set_api_key", { apiKey: apiKey.trim() });
      setSyncing(true);
      setSyncStatus("Synchronisation des signets...");
    } catch (err) {
      setError(String(err));
      setLoading(false);
    }
  };

  return (
    <div className="flex h-screen w-screen items-center justify-center bg-background">
      <div className="w-full max-w-[380px] px-6">
        <div className="mb-8">
          <h1 className="text-[22px] font-bold tracking-tight text-foreground">
            Connecting Dots
          </h1>
          <p className="mt-2 text-[14px] leading-relaxed text-muted-foreground">
            Organise automatiquement tes signets X en sujets thématiques grâce
            à l'IA.
          </p>
        </div>

        {!syncing ? (
          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label
                htmlFor="api-key"
                className="block text-[13px] font-medium text-foreground"
              >
                Clé API Anthropic
              </label>
              <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">
                Utilisée pour analyser et classer tes signets. La clé reste
                stockée localement sur ta machine.
              </p>
              <input
                id="api-key"
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="sk-ant-..."
                className="mt-3 w-full rounded-lg border border-border bg-background px-3 py-2.5 font-mono text-[13px] text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-[#1d9bf0]"
                autoFocus
              />
              <button
                type="button"
                onClick={() =>
                  invoke("open_in_browser", {
                    url: "https://console.anthropic.com/settings/keys",
                  })
                }
                className="mt-2 text-[12px] text-muted-foreground underline decoration-border underline-offset-2 transition-colors hover:text-foreground"
              >
                Obtenir une clé sur console.anthropic.com
              </button>
            </div>

            {error && (
              <p className="text-[12px] text-red-400">{error}</p>
            )}

            <button
              type="submit"
              disabled={loading || !apiKey.trim()}
              className="inline-flex w-full items-center justify-center gap-2 rounded-full bg-foreground py-2.5 text-[14px] font-semibold text-background transition-opacity hover:opacity-90 disabled:opacity-30"
            >
              {loading && <Loader2 size={14} className="animate-spin" />}
              Commencer
            </button>
          </form>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <Loader2
                size={16}
                className="shrink-0 animate-spin text-foreground"
              />
              <div className="min-w-0">
                <div className="text-[14px] font-medium text-foreground">
                  Première synchronisation
                </div>
                <div className="mt-0.5 text-[12px] text-muted-foreground">
                  {syncStatus}
                </div>
              </div>
            </div>
            <div className="h-px bg-border" />
            <p className="text-[12px] leading-relaxed text-muted-foreground">
              L'app récupère tes signets et les organise en sujets. Cela peut
              prendre quelques instants au premier lancement.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
