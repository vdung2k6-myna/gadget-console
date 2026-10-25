import { guideFor, type Block } from "@/lib/i18n/guide";
import { getStrings } from "@/lib/i18n/locale";

export const instant = false;

/**
 * The guide: one document, its contents generated from the same array as its
 * sections, so a section cannot exist without an entry that leads to it.
 *
 * It is readable without a session — the first thing somebody needs is to know
 * what they are signing up for — and it renders on the server, so it needs no
 * JavaScript at all.
 */
export default async function HelpPage() {
  const { locale, strings } = await getStrings();
  const guide = guideFor(locale);

  const contents = (
    <ol className="space-y-1 text-sm">
      {guide.sections.map((section, index) => (
        <li key={section.id}>
          <a href={`#${section.id}`} className="hover:underline">
            {index + 1}. {section.title}
          </a>
        </li>
      ))}
    </ol>
  );

  return (
    <main className="mx-auto flex w-full max-w-5xl gap-10 px-4 py-8">
      <aside className="hidden w-56 shrink-0 lg:block">
        <div className="sticky top-6">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
            {strings.help.contents}
          </h2>
          <nav className="mt-2">{contents}</nav>
        </div>
      </aside>

      <article className="min-w-0 max-w-3xl">
        <h1 className="text-2xl font-semibold">{guide.title}</h1>
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">{guide.intro}</p>

        <nav className="mt-6 rounded border border-zinc-200 p-4 lg:hidden dark:border-zinc-800">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
            {strings.help.contents}
          </h2>
          <div className="mt-2">{contents}</div>
        </nav>

        {guide.sections.map((section) => (
          <section key={section.id} id={section.id} className="mt-10 scroll-mt-6">
            <h2 className="text-lg font-semibold">
              <a href={`#${section.id}`} className="hover:underline">
                {section.title}
              </a>
            </h2>
            {section.blocks.map((block, index) => (
              <BlockView
                key={index}
                block={block}
                labels={{ cause: strings.help.cause, fix: strings.help.fix }}
              />
            ))}
          </section>
        ))}
      </article>
    </main>
  );
}

function BlockView({
  block,
  labels,
}: {
  block: Block;
  labels: { cause: string; fix: string };
}) {
  switch (block.kind) {
    case "p":
      return <p className="mt-3 leading-relaxed">{block.text}</p>;

    case "steps":
      return (
        <ol className="mt-3 list-decimal space-y-2 pl-6 leading-relaxed">
          {block.items.map((item, index) => (
            <li key={index}>{item}</li>
          ))}
        </ol>
      );

    case "note":
      return (
        <aside className="mt-3 rounded border-l-4 border-amber-400 bg-amber-50 px-4 py-3 text-sm text-amber-950 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100">
          {block.text}
        </aside>
      );

    case "error":
      return (
        <div className="mt-3 rounded border border-red-200 p-4 text-sm dark:border-red-900">
          <p className="font-medium">{block.symptom}</p>
          <p className="mt-2">
            <span className="text-zinc-500 dark:text-zinc-400">{labels.cause}: </span>
            {block.cause}
          </p>
          <p className="mt-1">
            <span className="text-zinc-500 dark:text-zinc-400">{labels.fix}: </span>
            {block.fix}
          </p>
        </div>
      );
  }
}
