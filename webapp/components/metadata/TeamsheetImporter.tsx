"use client";
import { useCallback, useRef, useState } from "react";
import type { PlayerEntry } from "../../lib/types/project";
import { parseTeamsheetCSV, parseTeamsheetPlainText } from "../../lib/metadata/teamsheetParser";

type Props = {
  onImport: (players: PlayerEntry[]) => void;
  onCancel: () => void;
};

type Step = "input" | "preview";

export default function TeamsheetImporter({ onImport, onCancel }: Props) {
  const [step, setStep] = useState<Step>("input");
  const [pasteText, setPasteText] = useState("");
  const [preview, setPreview] = useState<PlayerEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const parseAndPreview = useCallback((text: string, isCSV: boolean) => {
    setError(null);
    const players = isCSV ? parseTeamsheetCSV(text) : parseTeamsheetPlainText(text);
    if (players.length === 0) {
      setError("Could not parse any players from the input. Check the format and try again.");
      return;
    }
    setPreview(players);
    setStep("preview");
  }, []);

  const handleFile = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const text = await file.text();
      const ext = file.name.split(".").pop()?.toLowerCase();
      const isCSV = ext === "csv" || ext === "tsv";
      parseAndPreview(text, isCSV);
    },
    [parseAndPreview],
  );

  const handlePaste = useCallback(() => {
    if (!pasteText.trim()) return;
    // Heuristic: if first line looks like a header row with commas/tabs, treat as CSV
    const firstLine = pasteText.split(/\r?\n/)[0];
    const isCSV = firstLine.includes(",") || firstLine.includes("\t") || firstLine.includes(";");
    parseAndPreview(pasteText, isCSV);
  }, [pasteText, parseAndPreview]);

  const updatePreviewPlayer = (idx: number, patch: Partial<PlayerEntry>) => {
    setPreview((prev) => prev.map((p, i) => (i === idx ? { ...p, ...patch } : p)));
  };

  const removePreviewPlayer = (idx: number) => {
    setPreview((prev) => prev.filter((_, i) => i !== idx));
  };

  return (
    <div
      className="modal-overlay z-[9999]"
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div className="modal-card min-w-[480px] max-w-[640px] max-h-[80vh] overflow-y-auto p-5">
        <h3 className="mt-0 text-base font-bold">Import Teamsheet</h3>

        {step === "input" && (
          <>
            {/* File picker */}
            <div className="mb-3">
              <label className="text-xs text-secondary">
                Choose a file (CSV, TSV, or TXT):
              </label>
              <br />
              <input
                ref={fileRef}
                type="file"
                accept=".csv,.tsv,.txt"
                onChange={handleFile}
                className="mt-1 text-xs text-accent"
              />
            </div>

            <div className="text-center text-muted text-xs my-2">
              — or paste text below —
            </div>

            {/* Paste area */}
            <textarea
              value={pasteText}
              onChange={(e) => setPasteText(e.target.value)}
              rows={8}
              placeholder={`Paste teamsheet text here, e.g.:\n1 A. Goalkeeper\n2 B. Defender\n3 C. Midfielder\n...\n\nor CSV with headers:\nNumber,Name,Position\n1,A. Goalkeeper,GK`}
              className="w-full bg-raised text-accent border border-border p-2 resize-y font-mono text-xs"
            />

            {error && (
              <div className="text-danger text-xs mt-1.5">
                {error}
              </div>
            )}

            <div className="flex gap-2 mt-3 justify-end">
              <button onClick={onCancel}>Cancel</button>
              <button onClick={handlePaste} disabled={!pasteText.trim()} className="bg-accent text-on-accent hover:bg-accent-hover">
                Parse
              </button>
            </div>
          </>
        )}

        {step === "preview" && (
          <>
            <div className="text-xs text-secondary mb-2">
              {preview.length} player(s) detected. Edit if needed, then confirm.
            </div>

            <table className="w-full border-collapse text-xs">
              <thead>
                <tr className="text-secondary text-left">
                  <th className="w-10 px-0.5 py-1">#</th>
                  <th className="px-0.5 py-1">Name</th>
                  <th className="w-15 px-0.5 py-1">Pos</th>
                  <th className="w-7 px-0.5 py-1 text-center">C</th>
                  <th className="w-7 px-0.5 py-1 text-center">S</th>
                  <th className="w-7" />
                </tr>
              </thead>
              <tbody>
                {preview.map((p, i) => (
                  <tr key={p.id}>
                    <td>
                      <input
                        type="number"
                        min={0}
                        value={p.number ?? ""}
                        onChange={(e) =>
                          updatePreviewPlayer(i, {
                            number: e.target.value === "" ? null : parseInt(e.target.value, 10),
                          })
                        }
                        className="bg-transparent text-accent border-0 border-b border-border px-0.5 py-1 text-xs w-9 text-center outline-none"
                      />
                    </td>
                    <td>
                      <input
                        type="text"
                        value={p.name}
                        onChange={(e) => updatePreviewPlayer(i, { name: e.target.value })}
                        className="bg-transparent text-accent border-0 border-b border-border px-0.5 py-1 text-xs w-full outline-none"
                      />
                    </td>
                    <td>
                      <input
                        type="text"
                        value={p.position ?? ""}
                        onChange={(e) =>
                          updatePreviewPlayer(i, { position: e.target.value || null })
                        }
                        className="bg-transparent text-accent border-0 border-b border-border px-0.5 py-1 text-xs w-13 outline-none"
                      />
                    </td>
                    <td className="text-center">
                      <input
                        type="checkbox"
                        checked={!!p.isCaptain}
                        onChange={(e) =>
                          updatePreviewPlayer(i, { isCaptain: e.target.checked || undefined })
                        }
                      />
                    </td>
                    <td className="text-center">
                      <input
                        type="checkbox"
                        checked={!!p.isSubstitute}
                        onChange={(e) =>
                          updatePreviewPlayer(i, { isSubstitute: e.target.checked || undefined })
                        }
                      />
                    </td>
                    <td>
                      <button
                        onClick={() => removePreviewPlayer(i)}
                        className="bg-transparent border-0 text-danger cursor-pointer text-sm px-1"
                        title="Remove"
                      >
                        ×
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div className="flex gap-2 mt-3 justify-end">
              <button onClick={() => { setStep("input"); setError(null); }}>
                ← Back
              </button>
              <button onClick={onCancel}>Cancel</button>
              <button
                onClick={() => onImport(preview)}
                disabled={preview.length === 0}
                className="bg-accent text-on-accent hover:bg-accent-hover"
              >
                Confirm ({preview.length})
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
