"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import type { BinaryReport, EspImage, FoundString } from "@/lib/binary-inspect";
import type { AdminStrings } from "@/lib/i18n/admin-strings";

/**
 * One file in, its anatomy out — and, when asked, a patched copy back.
 *
 * The routes own the parsing, the limits and the rewriting; this carries the file up,
 * draws what came back, and turns a response body into a download. Nothing here
 * decides that bytes are valid: an image is only offered for download after the route
 * has read it back as one.
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

function baseName(name: string): string {
  return name.replace(/\.bin$/i, "") || "firmware";
}

/** Hand a response body to the browser as a file. The URL is revoked after the click
 *  has been read, rather than immediately, which some browsers still need. */
function download(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-zinc-500 dark:text-zinc-400">{label}</dt>
      <dd className="mt-0.5 font-mono text-xs break-all">{value}</dd>
    </div>
  );
}

function ImageCard({
  image,
  strings,
  onExtract,
}: {
  image: EspImage;
  strings: AdminStrings;
  onExtract: (offset: number) => void;
}) {
  return (
    <div className="rounded border border-zinc-200 p-4 dark:border-zinc-800">
      <h3 className="text-sm font-semibold">
        {strings.images} · {hex(image.offset)} · {image.kind}
        <button
          type="button"
          onClick={() => onExtract(image.offset)}
          className="ml-3 text-xs font-normal underline decoration-dotted"
        >
          {strings.extract}
        </button>
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
        <Field
          label={strings.signature}
          value={
            image.signature === null
              ? strings.unsigned
              : `${image.signature.kind === "rsa" ? "RSA" : "ECDSA"} · ${image.signature.blocks} ${strings.blocks}`
          }
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
  const [source, setSource] = useState<File | null>(null);

  const [imageOffset, setImageOffset] = useState(0);
  const [find, setFind] = useState("");
  const [found, setFound] = useState<FoundString[] | null>(null);
  const [selected, setSelected] = useState<FoundString | null>(null);
  const [edited, setEdited] = useState("");
  const [finding, setFinding] = useState(false);
  const [stringsError, setStringsError] = useState("");
  const [address, setAddress] = useState<string | null>(null);
  const [addressEdited, setAddressEdited] = useState("");
  const [addressError, setAddressError] = useState("");
  const [patching, setPatching] = useState(false);
  const [patchError, setPatchError] = useState("");
  const [patched, setPatched] = useState<{
    blob: Blob;
    name: string;
    occurrences: number;
    sha256: string;
    signed: boolean;
  } | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [saved, setSaved] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const file = (form.elements.namedItem("file") as HTMLInputElement | null)?.files?.[0] ?? null;
    setPending(true);
    setError("");
    setReport(null);
    resetPatch();

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

    const next = (await response.json()) as BinaryReport;
    const preferred = next.images.find((image) => image.kind === "app") ?? next.images[0];
    setSource(file);
    setReport(next);
    setImageOffset(preferred?.offset ?? 0);
  }

  function resetPatch(clearQuery = true) {
    if (clearQuery) setFind("");
    setFound(null);
    setSelected(null);
    setEdited("");
    setStringsError("");
    setAddress(null);
    setAddressEdited("");
    setAddressError("");
    setPatchError("");
    setPatched(null);
    setSaved(false);
  }

  /** The strings containing the query, so the edit is made to a whole value rather
   *  than to a fragment that would leave a NUL in the middle of it. */
  async function findValues(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (source === null) return;

    const body = new FormData();
    body.append("file", source);
    body.append("offset", String(imageOffset));
    body.append("find", find);

    setFinding(true);
    setStringsError("");
    setFound(null);
    setSelected(null);
    setEdited("");
    setPatched(null);
    setPatchError("");
    setSaved(false);

    const response = await fetch("/api/admin/inspect/strings", {
      method: "POST",
      credentials: "same-origin",
      body,
    });
    setFinding(false);
    if (!response.ok) {
      setStringsError(strings.patchFailed);
      return;
    }

    const answer = (await response.json()) as { strings?: FoundString[] };
    const values = answer.strings ?? [];
    setFound(values);
    if (values.length === 0) setStringsError(strings.stringsEmpty);
  }

  function choose(entry: FoundString) {
    setSelected(entry);
    setEdited(entry.value);
    setPatched(null);
    setPatchError("");
    setSaved(false);
  }

  const bytesIn = (value: string): number => new TextEncoder().encode(value).length;
  const tooLong = selected !== null && bytesIn(edited) > bytesIn(selected.value);
  const addressTooLong = address !== null && bytesIn(addressEdited) > bytesIn(address);

  function chooseAddress(value: string) {
    setAddress(value);
    setAddressEdited(value);
    setAddressError("");
    setPatched(null);
    setSaved(false);
  }

  async function applyPatch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (source === null || selected === null) return;

    const body = new FormData();
    body.append("file", source);
    body.append("offset", String(imageOffset));
    body.append("mode", "string");
    body.append("original", selected.value);
    body.append("replace", edited);

    setPatching(true);
    setPatchError("");
    setPatched(null);
    setSaved(false);

    const response = await fetch("/api/admin/inspect/patch", {
      method: "POST",
      credentials: "same-origin",
      body,
    });
    setPatching(false);

    if (!response.ok) {
      const failure = (await response.json().catch(() => ({}))) as { error?: unknown };
      setPatchError(
        failure.error === "longer"
          ? strings.patchLonger
          : failure.error === "not-found"
            ? strings.patchNotFound
            : failure.error === "empty-find"
              ? strings.patchEmpty
              : strings.patchFailed
      );
      return;
    }

    setPatched({
      blob: await response.blob(),
      name: `${baseName(source.name)}-patched.bin`,
      occurrences: Number(response.headers.get("x-patch-occurrences") ?? "0"),
      sha256: response.headers.get("x-patch-sha256") ?? "",
      signed: response.headers.get("x-patch-signed") === "1",
    });
  }

  async function applyAddress(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (source === null || address === null) return;

    const body = new FormData();
    body.append("file", source);
    body.append("mode", "address");
    body.append("original", address);
    body.append("replace", addressEdited);

    setPatching(true);
    setAddressError("");
    setPatched(null);
    setSaved(false);

    const response = await fetch("/api/admin/inspect/patch", {
      method: "POST",
      credentials: "same-origin",
      body,
    });
    setPatching(false);

    if (!response.ok) {
      const failure = (await response.json().catch(() => ({}))) as { error?: unknown };
      setAddressError(
        failure.error === "longer"
          ? strings.patchLonger
          : failure.error === "not-found"
            ? strings.patchNotFound
            : failure.error === "ambiguous"
              ? strings.addressAmbiguous
              : strings.patchFailed
      );
      return;
    }

    setPatched({
      blob: await response.blob(),
      name: `${baseName(source.name)}-patched.bin`,
      occurrences: Number(response.headers.get("x-patch-occurrences") ?? "0"),
      sha256: response.headers.get("x-patch-sha256") ?? "",
      signed: response.headers.get("x-patch-signed") === "1",
    });
  }

  async function extract(offset: number) {
    if (source === null) return;
    const body = new FormData();
    body.append("file", source);
    body.append("offset", String(offset));

    const response = await fetch("/api/admin/inspect/extract", {
      method: "POST",
      credentials: "same-origin",
      body,
    });
    if (!response.ok) {
      setPatchError(strings.patchFailed);
      return;
    }
    download(await response.blob(), `${baseName(source.name)}-${hex(offset)}.bin`);
  }

  async function saveRelease(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (patched === null) return;
    const form = event.currentTarget;
    const body = new FormData();
    body.append("boardType", (form.elements.namedItem("boardType") as HTMLInputElement).value);
    body.append("version", (form.elements.namedItem("version") as HTMLInputElement).value);
    body.append("file", patched.blob, patched.name);

    setSaving(true);
    setSaveError("");
    setSaved(false);
    const response = await fetch("/api/admin/firmware", {
      method: "POST",
      credentials: "same-origin",
      body,
    });
    setSaving(false);
    if (!response.ok) {
      setSaveError(strings.saveFailed);
      return;
    }
    setSaved(true);
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
            <ImageCard key={image.offset} image={image} strings={strings} onExtract={extract} />
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

          {report.images.length > 0 && (
            <div className="rounded border border-zinc-200 p-4 dark:border-zinc-800">
              <h3 className="text-sm font-semibold">{strings.patch}</h3>
              <p className="mt-1 text-xs text-amber-700 dark:text-amber-300">{strings.patchNote}</p>

              <form className="mt-3 flex flex-wrap items-end gap-3" onSubmit={findValues}>
                <label className="flex flex-col gap-1 text-sm">
                  {strings.patchImage}
                  <select
                    value={imageOffset}
                    onChange={(event) => {
                      setImageOffset(Number(event.target.value));
                      resetPatch(false);
                    }}
                    className="rounded border border-zinc-300 bg-white px-3 py-2 font-mono text-xs dark:border-zinc-700 dark:bg-zinc-900"
                  >
                    {report.images.map((image) => (
                      <option key={image.offset} value={image.offset}>
                        {`${hex(image.offset)} · ${image.kind}`}
                        {image.app !== null ? ` · ${image.app.project} ${image.app.version}` : ""}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex flex-col gap-1 text-sm">
                  {strings.patchFind}
                  <input
                    value={find}
                    onChange={(event) => setFind(event.target.value)}
                    required
                    className="rounded border border-zinc-300 bg-white px-3 py-2 font-mono text-xs dark:border-zinc-700 dark:bg-zinc-900"
                  />
                </label>
                <button
                  type="submit"
                  disabled={finding}
                  className="rounded border border-zinc-300 px-3 py-2 text-sm hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
                >
                  {strings.stringsFind}
                </button>
              </form>

              {stringsError !== "" && (
                <p role="alert" className="mt-3 text-sm text-red-700 dark:text-red-300">
                  {stringsError}
                </p>
              )}

              {found !== null && found.length > 0 && (
                <ul className="mt-3 space-y-1">
                  {found.map((entry) => (
                    <li key={entry.offset}>
                      <button
                        type="button"
                        onClick={() => choose(entry)}
                        className={`w-full rounded border px-3 py-2 text-left font-mono text-xs break-all ${
                          selected?.offset === entry.offset
                            ? "border-emerald-400 bg-emerald-50 dark:border-emerald-700 dark:bg-emerald-950"
                            : "border-zinc-200 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-900"
                        }`}
                      >
                        {entry.value}
                      </button>
                    </li>
                  ))}
                </ul>
              )}

              {selected !== null && (
                <>
                  <form className="mt-3 flex flex-wrap items-end gap-3" onSubmit={applyPatch}>
                    <label className="flex min-w-0 flex-1 flex-col gap-1 text-sm">
                      {strings.stringsEdit}
                      <input
                        value={edited}
                        onChange={(event) => setEdited(event.target.value)}
                        className="w-full rounded border border-zinc-300 bg-white px-3 py-2 font-mono text-xs dark:border-zinc-700 dark:bg-zinc-900"
                      />
                    </label>
                    <button
                      type="submit"
                      disabled={patching || tooLong}
                      className="rounded border border-zinc-300 px-3 py-2 text-sm hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
                    >
                      {strings.patchApply}
                    </button>
                  </form>

                  <div className="mt-3 rounded border border-zinc-200 p-3 dark:border-zinc-800">
                    <p className="text-xs text-zinc-500 dark:text-zinc-400">{strings.stringsResult}</p>
                    <p className="mt-1 font-mono text-xs break-all">
                      {edited === "" ? strings.none : edited}
                    </p>
                    {tooLong && (
                      <p className="mt-1 text-sm text-red-700 dark:text-red-300">{strings.stringsTooLong}</p>
                    )}
                  </div>
                </>
              )}

              {patchError !== "" && (
                <p role="alert" className="mt-3 text-sm text-red-700 dark:text-red-300">
                  {patchError}
                </p>
              )}

            </div>
          )}

          <div className="rounded border border-zinc-200 p-4 dark:border-zinc-800">
            <h3 className="text-sm font-semibold">{strings.urls}</h3>
            {report.urls.length === 0 ? (
              <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">{strings.none}</p>
            ) : (
              <ul className="mt-2 space-y-1 text-xs">
                {report.urls.map((url) => (
                  <li key={url} className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="min-w-0 font-mono break-all">{url}</span>
                    <button
                      type="button"
                      onClick={() => chooseAddress(url)}
                      className="ml-auto shrink-0 underline decoration-dotted"
                    >
                      {strings.edit}
                    </button>
                  </li>
                ))}
              </ul>
            )}

            {address !== null && (
              <>
                <form className="mt-3 flex flex-wrap items-end gap-3" onSubmit={applyAddress}>
                  <label className="flex min-w-0 flex-1 flex-col gap-1 text-sm">
                    {strings.addressEdit}
                    <input
                      value={addressEdited}
                      onChange={(event) => setAddressEdited(event.target.value)}
                      className="w-full rounded border border-zinc-300 bg-white px-3 py-2 font-mono text-xs dark:border-zinc-700 dark:bg-zinc-900"
                    />
                  </label>
                  <button
                    type="submit"
                    disabled={patching || addressTooLong}
                    className="rounded border border-zinc-300 px-3 py-2 text-sm hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
                  >
                    {strings.patchApply}
                  </button>
                </form>

                <div className="mt-3 rounded border border-zinc-200 p-3 dark:border-zinc-800">
                  <p className="text-xs text-zinc-500 dark:text-zinc-400">{strings.stringsResult}</p>
                  <p className="mt-1 font-mono text-xs break-all">
                    {addressEdited === "" ? strings.none : addressEdited}
                  </p>
                  {addressTooLong && (
                    <p className="mt-1 text-sm text-red-700 dark:text-red-300">{strings.stringsTooLong}</p>
                  )}
                </div>

                {addressError !== "" && (
                  <p role="alert" className="mt-3 text-sm text-red-700 dark:text-red-300">
                    {addressError}
                  </p>
                )}
              </>
            )}
          </div>

          {patched !== null && (
            <div className="rounded border border-emerald-300 bg-emerald-50 p-4 dark:border-emerald-800 dark:bg-emerald-950">
              <p className="text-sm text-emerald-900 dark:text-emerald-100">
                {strings.patchMade.replace("{count}", String(patched.occurrences))}
              </p>
              {patched.signed && (
                <p className="mt-1 text-sm text-amber-800 dark:text-amber-200">{strings.patchResign}</p>
              )}
              <p className="mt-1 font-mono text-xs break-all text-emerald-900 dark:text-emerald-100">
                {patched.sha256}
              </p>
              <button
                type="button"
                onClick={() => download(patched.blob, patched.name)}
                className="mt-2 rounded border border-emerald-400 px-3 py-2 text-sm hover:bg-emerald-100 dark:border-emerald-700 dark:hover:bg-emerald-900"
              >
                {strings.download}
              </button>

              <form className="mt-3 flex flex-wrap items-end gap-3" onSubmit={saveRelease}>
                <label className="flex flex-col gap-1 text-sm">
                  {strings.boardType}
                  <input
                    name="boardType"
                    required
                    placeholder="esp-box-3"
                    className="rounded border border-zinc-300 bg-white px-3 py-2 font-mono text-sm dark:border-zinc-700 dark:bg-zinc-900"
                  />
                </label>
                <label className="flex flex-col gap-1 text-sm">
                  {strings.version}
                  <input
                    name="version"
                    required
                    placeholder="1.2.4"
                    className="rounded border border-zinc-300 bg-white px-3 py-2 font-mono text-sm dark:border-zinc-700 dark:bg-zinc-900"
                  />
                </label>
                <button
                  type="submit"
                  disabled={saving}
                  className="rounded border border-zinc-300 px-3 py-2 text-sm hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
                >
                  {strings.saveAsRelease}
                </button>
              </form>
              {saveError !== "" && (
                <p role="alert" className="mt-2 text-sm text-red-700 dark:text-red-300">
                  {saveError}
                </p>
              )}
              {saved && (
                <p className="mt-2 text-sm">
                  <Link href="/admin/firmware" className="underline">
                    {strings.saved}
                  </Link>
                </p>
              )}
            </div>
          )}

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
