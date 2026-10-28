import { useEffect, useState } from "react";
import { Check, Loader } from "../../../shared/ui/icons";
import { prettyCwd } from "../../../shared/lib/paths";
import {
  formatPortRange,
  inheritedConfig,
  loadWorktreeSettings,
  localConfigFromForm,
  saveWorktreeSettings,
  type WorktreeSettings,
} from "../model/worktreeEnv";

/** Port range and setup command every new worktree of `project` gets. */
export function WorktreeEnvironmentSettings({ project }: { project: string }) {
  const [settings, setSettings] = useState<WorktreeSettings>();
  const [loadError, setLoadError] = useState<string>();
  const [portRange, setPortRange] = useState("");
  const [setup, setSetup] = useState("");
  const [dev, setDev] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string>();

  const fill = (next: WorktreeSettings) => {
    setSettings(next);
    setPortRange(formatPortRange(next.effective.portRange));
    setSetup(next.effective.setup ?? "");
    setDev(next.effective.dev ?? "");
  };

  useEffect(() => {
    let current = true;
    setSettings(undefined);
    setLoadError(undefined);
    setError(undefined);
    setSaved(false);
    if (!project) return;
    void loadWorktreeSettings(project)
      .then((next) => {
        if (current) fill(next);
      })
      .catch((reason) => {
        if (current) setLoadError(String(reason));
      });
    return () => {
      current = false;
    };
  }, [project]);

  if (!project) return null;
  if (loadError) {
    return (
      <section className="rounded-xl border border-stroke p-4 text-[12px] text-content/50">
        Worktree environment is unavailable for this project: {loadError}
      </section>
    );
  }
  if (!settings) {
    return (
      <section className="flex items-center gap-2 rounded-xl border border-stroke p-4 text-[12px] text-content/50">
        <Loader className="size-4 animate-spin" />
        Loading worktree environment…
      </section>
    );
  }

  const inherited = inheritedConfig(settings);
  const save = async () => {
    const form = localConfigFromForm(portRange, setup, inherited, dev);
    if (!form.config) {
      setError(form.error);
      return;
    }
    setSaving(true);
    setError(undefined);
    try {
      fill(await saveWorktreeSettings(project, form.config));
      setSaved(true);
    } catch (reason) {
      setError(String(reason));
    } finally {
      setSaving(false);
    }
  };

  return (
    <section
      data-setting-id="worktree-environment"
      className="flex flex-col gap-3 rounded-xl border border-stroke p-4"
    >
      <div>
        <h3 className="text-[13px] font-medium">Worktree environment</h3>
        <p className="mt-1 text-[12px] text-content/50">
          Each worktree gets its own port as <code>PORT</code> and{" "}
          <code>IRGATOS_PORT</code> in its agents and terminals, so parallel dev
          servers never clash. The setup command runs once in every new
          worktree, with <code>IRGATOS_MAIN_WORKTREE</code> pointing at this
          checkout.
        </p>
      </div>
      <form
        className="flex flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <label className="flex flex-col gap-1">
          <span className="text-[12px] text-content/70">Port range</span>
          <input
            value={portRange}
            onChange={(event) => {
              setPortRange(event.target.value);
              setSaved(false);
            }}
            placeholder={formatPortRange(inherited.portRange)}
            aria-label="Worktree port range"
            inputMode="numeric"
            className="h-8 w-48 rounded-md border border-content/10 bg-content/5 px-2 font-mono text-[12px] outline-none focus:border-content/25"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[12px] text-content/70">Setup command</span>
          <textarea
            value={setup}
            onChange={(event) => {
              setSetup(event.target.value);
              setSaved(false);
            }}
            rows={2}
            spellCheck={false}
            placeholder="pnpm install --offline && cp .env.example .env"
            aria-label="Worktree setup command"
            className="min-h-14 resize-y rounded-md border border-content/10 bg-content/5 px-2 py-1.5 font-mono text-[12px] outline-none focus:border-content/25"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[12px] text-content/70">
            Development command
          </span>
          <input
            value={dev}
            onChange={(event) => {
              setDev(event.target.value);
              setSaved(false);
            }}
            spellCheck={false}
            placeholder="npm run dev"
            aria-label="Development command"
            className="h-8 rounded-md border border-content/10 bg-content/5 px-2 font-mono text-[12px] outline-none focus:border-content/25"
          />
          <span className="text-[11px] text-content/40">
            Never run on its own. After a restart, terminals show whether it is
            running and offer “Start development environment”.
          </span>
        </label>
        <p className="text-[11px] text-content/40">
          {settings.sharedPath ? (
            <>
              Team defaults come from{" "}
              <span className="break-all">{prettyCwd(settings.sharedPath)}</span>
              {settings.shared.setup ||
              settings.shared.portRange ||
              settings.shared.dev
                ? "; values you change here apply to this clone only."
                : " when it exists. Changes here apply to this clone only."}
            </>
          ) : (
            "Changes here apply to this clone only."
          )}
        </p>
        {settings.sharedError ? (
          <p role="alert" className="text-[12px] text-amber-400">
            .irgatos/worktree.json was ignored: {settings.sharedError}
          </p>
        ) : null}
        {error ? (
          <p role="alert" className="text-[12px] text-red-400">
            {error}
          </p>
        ) : null}
        <div className="flex items-center gap-2">
          <button
            type="submit"
            disabled={saving}
            className="flex h-7.5 items-center gap-1.5 rounded-md bg-content/10 px-3 text-[12px] hover:bg-content/15 disabled:opacity-40 active:scale-[0.97]"
          >
            {saving ? <Loader className="size-3.5 animate-spin" /> : null}
            Save
          </button>
          {saved ? (
            <span className="flex items-center gap-1 text-[11px] text-content/50">
              <Check className="size-3" />
              Saved. New worktrees use these settings.
            </span>
          ) : null}
        </div>
      </form>
    </section>
  );
}
