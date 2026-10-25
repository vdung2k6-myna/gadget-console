/**
 * The guide's shape.
 *
 * Blocks rather than free prose so a section can be rendered without parsing
 * anything, and so a step or a documented failure has somewhere to live that a
 * reader can see at a glance. The ids are anchors: a warning elsewhere in the
 * interface links to one of them.
 */
export type Block =
  | { kind: "p"; text: string }
  | { kind: "steps"; items: string[] }
  | { kind: "note"; text: string }
  | { kind: "error"; symptom: string; cause: string; fix: string };

export interface Section {
  id: string;
  title: string;
  blocks: Block[];
}

export interface Guide {
  title: string;
  intro: string;
  sections: Section[];
}
