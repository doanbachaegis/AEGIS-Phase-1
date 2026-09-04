/**
 * Shown when `./env.ts` refuses to load.
 *
 * Deliberately imports nothing from `./env.js` — importing it is what throws. An
 * evidence page that renders empty because a deploy lost its contract ID is worse than
 * no page at all: it looks like a decision that does not exist.
 */
export function ConfigError({ error }: { error: unknown }) {
  const problems =
    typeof error === "object" &&
    error !== null &&
    "problems" in error &&
    Array.isArray((error as { problems: unknown }).problems)
      ? ((error as { problems: unknown[] }).problems.filter(
          (p): p is string => typeof p === "string",
        ) as string[])
      : [];

  const message = error instanceof Error ? error.message : String(error);

  return (
    <main className="mx-auto max-w-3xl p-6">
      <h1 className="text-2xl font-bold text-red-900">This console is misconfigured</h1>
      <p className="mt-2 max-w-2xl text-sm text-slate-700">
        It is refusing to render rather than showing an evidence page with nothing in it. No
        conclusion should be drawn about any decision from this screen.
      </p>
      {problems.length > 0 ? (
        <ul className="mt-4 list-disc space-y-1 pl-6 text-sm text-red-900">
          {problems.map((p) => (
            <li key={p}>
              <code className="font-mono">{p}</code>
            </li>
          ))}
        </ul>
      ) : (
        <pre className="mt-4 overflow-x-auto rounded border border-red-200 bg-red-50 p-3 text-xs text-red-900">
          {message}
        </pre>
      )}
      <p className="mt-4 text-sm text-slate-700">
        Set the missing variables and redeploy — see{" "}
        <code className="font-mono">apps/console/.env.example</code>.
      </p>
    </main>
  );
}
