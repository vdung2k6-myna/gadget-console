import { CalibrationDefaultForm } from "@/components/CalibrationDefaultForm";
import { requireAdmin } from "@/lib/auth/admin";
import { getDefaultPair } from "@/lib/device-calibration";

export const instant = false;

/** The deployment's default calibration: what a device without its own pair uses. */
export default async function CalibrationSettingsPage() {
  await requireAdmin();
  const pair = await getDefaultPair();

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-8">
      <h1 className="text-2xl font-semibold">Calibration default</h1>
      <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
        The speech gate's pair for devices that have not calibrated their own.
      </p>
      <section className="mt-6">
        <CalibrationDefaultForm initial={pair} />
      </section>
    </main>
  );
}
