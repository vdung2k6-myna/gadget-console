import { CalibrationDefaultForm } from "@/components/CalibrationDefaultForm";
import { requireAdmin } from "@/lib/auth/admin";
import { getDefaultPair } from "@/lib/device-calibration";
import { adminStringsFor } from "@/lib/i18n/admin-strings";
import { getStrings } from "@/lib/i18n/locale";

export const instant = false;

/** The deployment's default calibration: what a device without its own pair uses. */
export default async function CalibrationSettingsPage() {
  await requireAdmin();
  const { locale } = await getStrings();
  const labels = adminStringsFor(locale).calibration;
  const pair = await getDefaultPair();

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-8">
      <h1 className="text-2xl font-semibold">{labels.defaultHeading}</h1>
      <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">{labels.defaultHelp}</p>
      <section className="mt-6">
        <CalibrationDefaultForm initial={pair} labels={labels} />
      </section>
    </main>
  );
}
