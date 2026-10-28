"use client";

import { useState, type FormEvent } from "react";
import type { BinaryReport, EspImage } from "@/lib/binary-inspect";
import type { AdminStrings } from "@/lib/i18n/admin-strings";

/**
 * One file in, its anatomy out.
 *
 * The route owns the parsing and the limits; this only carries the file up and draws
 * what came back. Nothing here interprets a field — a value is shown as the bytes
 * gave it, including the ones that say the image does not add up.
 */

function bytesText(bytes: number): string {
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${Number.isInteger(value) ? value : value.toFixed(1)} ${units[unit]}`;
}

function hex(value: number, width = 8): string {
  return `0x${value.toString(16).padStart(width, "0")}`;
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-zinc-500 dark:text-zinc-400">{label}</dt>
      <dd className="mt-0.5 font-mono text-xs break-all">{value}</dd>
    </div>
  );
}

function ImageCard({ image, strings }: { image: EspImage; strings: AdminStrings }) {
  return (
    <div className="rounded border border-zinc-200 p-4 dark:border-zinc-800">
      <h3 className="text-sm font-semibold">
        {strings.images} · {hex(image.offset)} · {image.kind}
      </h3>

      <dl className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label={strings.chip} value={image.chip ?? strings.none} />
        <Field label={strings.entryPoint} value={hex(image.entryPoint)} />
        <Field
          label={strings.flash}
          value={`${image.flasMode} · ${image.flashSize} · ${image.flashFreq}`}
        />
        <Field
          label={strings.checksum}
          value={image.checksumValid === null ? strings.none : image.checksumValid ? strings.valid : strings.invalid}
        />
        <Field
          label={strings.imageHash}
          value={image.hashValid === null ? strings.none : image.hashValid ? strings.valid : strings.invalid}
        />
      </dl>

      {image.app !== null && (
        <dl className="mt-3 grid grid-cols-1 gap-3 border-t border-zinc-100 pt-3 sm:grid-cols-2 dark:border-zinc-900">
          <Field label={strings.project} value={image.app.project || strings.none} />
          <Field label={strings.appVersion} value={image.app.version || strings.none} />
          <Field label={strings.compiled} value={`${image.app.date} ${image.app.time}`.trim() || strings.none} />
          <Field label={strings.idfVersion} value={image.app.idf || strings.none} />
          <Field label={strings.elfSha} value={image.app.elfSha256} />
          <Field label={strings.secureVersion} value={String(image.app.secureVersion)} />
        </dl>
      )}

      <table className="mt-3 w-full border-collapse text-xs">
        <thead>
          <tr className="border-b border-zinc-200 text-left dark:border-zinc-800">
            <th className="py-1 pr-4 font-medium">{strings.segments}</th>
            <th className="py-1 pr-4 font-medium">{strings.type}</th>
            <th className="py-1 pr-4 font-medium">{strings.loadAddress}</th>
            <th className="py-1 font-medium">{strings.size}</th>
          </tr>
        </thead>
        <tbody>
          {image.segments.map((segment) => (
            <tr key={segment.index} className="border-b border-zinc-100 dark:border-zinc-900">
              <td className="py-1 pr-4 font-mono">{segment.index}</td>
              <td className="py-1 pr-4 font-mono">{segment.type}</td>
              <td className="py-1 pr-4 font-mono">{hex(segment.loadAddress)}</td>
              <td className="py-1 whitespace-nowrap">{bytesText(segment.length)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function BinaryInspector({ strings }: { strings: AdminStrings }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [report, setReport] = useState<BinaryReport | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    setPending(true);
    setError("");
    setReport(null);

    const response = await fetch("/api/admin/inspect", {
      method: "POST",
      credentials: "same-origin",
      body: new FormData(form),
    });
    setPending(false);

    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as { error?: unknown };
      setError(
        body.error === "too-large"
          ? strings.inspectTooLarge
          : body.error === "empty"
            ? strings.inspectEmpty
            : strings.inspectFailed
      );
      return;
    }
    setReport((await response.json()) as BinaryReport);
  }

  return (
    <>
      <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">{strings.inspectHelp}</p>

      <form
        className="mt-4 flex flex-wrap items-end gap-3 rounded border border-zinc-200 p-4 dark:border-zinc-800"
        onSubmit={submit}
      >
        <label className="flex flex-col gap-1 text-sm">
          {strings.inspectFile}
          <input
            name="file"
            type="file"
            required
            accept=".bin,application/octet-stream"
            className="text-sm"
          />
        </label>
        <button
          type="submit"
          disabled={pending}
          className="rounded border border-zinc-300 px-3 py-2 text-sm hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
        >
          {strings.inspectRun}
        </button>
        {error !== "" && (
          <span role="alert" className="text-sm text-red-700 dark:text-red-300">
            {error}
          </span>
        )}
      </form>

      {report !== null && (
        <section className="mt-6 space-y-4">
          <div className="rounded border border-zinc-200 p-4 dark:border-zinc-800">
            <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label={strings.kind} value={report.kind} />
              <Field label={strings.size} value={bytesText(report.size)} />
              <Field label={strings.hash} value={report.sha256} />
              <Field label={strings.firstBytes} value={report.firstBytes} />
            </dl>
          </div>

          {report.images.map((image) => (
            <ImageCard key={image.offset} image={image} strings={strings} />
          ))}

          {report.partitions !== null && (
            <div className="rounded border border-zinc-200 p-4 dark:border-zinc-800">
              <h3 className="text-sm font-semibold">{strings.partitions}</h3>
              <table className="mt-2 w-full border-collapse text-xs">
                <thead>
                  <tr className="border-b border-zinc-200 text-left dark:border-zinc-800">
                    <th className="py-1 pr-4 font-medium">{strings.label}</th>
                    <th className="py-1 pr-4 font-medium">{strings.type}</th>
                    <th className="py-1 pr-4 font-medium">{strings.subtype}</th>
                    <th className="py-1 pr-4 font-medium">{strings.offset}</th>
                    <th className="py-1 font-medium">{strings.size}</th>
                  </tr>
                </thead>
                <tbody>
                  {report.partitions.map((entry, index) => (
                    <tr key={index} className="border-b border-zinc-100 dark:border-zinc-900">
                      <td className="py-1 pr-4 font-mono">{entry.label}</td>
                      <td className="py-1 pr-4 font-mono">{entry.type}</td>
                      <td className="py-1 pr-4 font-mono">{entry.subtype}</td>
                      <td className="py-1 pr-4 font-mono">{hex(entry.offset)}</td>
                      <td className="py-1 whitespace-nowrap">{bytesText(entry.size)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="rounded border border-zinc-200 p-4 dark:border-zinc-800">
            <h3 className="text-sm font-semibold">{strings.urls}</h3>
            {report.urls.length === 0 ? (
              <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">{strings.none}</p>
            ) : (
              <ul className="mt-2 space-y-1 text-xs">
                {report.urls.map((url) => (
                  <li key={url} className="font-mono break-all">
                    {url}
                  </li>
                ))}
              </ul>
            )}
          </div>

          {report.notes.length > 0 && (
            <div className="rounded border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100">
              <h3 className="font-semibold">{strings.notes}</h3>
              <ul className="mt-1 list-disc pl-5">
                {report.notes.map((note) => (
                  <li key={note}>{note}</li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}
    </>
  );
}
