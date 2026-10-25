import type { Strings } from "./vi";

/**
 * The English dictionary. `Strings` is the Vietnamese one's shape, so a key this
 * file lacks — or carries and the other does not — fails the build.
 */
export const en: Strings = {
  appName: "Gadget Console",

  nav: {
    devices: "Devices",
    agents: "Agents",
    llmProfiles: "LLM",
    help: "Guide",
    signOut: "Sign out",
  },

  locale: {
    label: "Language",
    vi: "Tiếng Việt",
    en: "English",
  },

  signIn: {
    heading: "Sign in",
    subtitle: "Manage your XiaoZhi gadgets and what they say.",
    email: "Email",
    password: "Password",
    submit: "Sign in",
    failed: "That email and password do not match an account.",
  },

  signUp: {
    heading: "Create an account",
    email: "Email",
    password: "Password (at least 8 characters)",
    submit: "Create account",
    failed: "The account could not be created.",
  },

  devices: {
    heading: "Devices",
    empty: "You have no devices yet. Enter the code on the gadget's screen to add one.",
    name: "Name",
    agent: "Agent",
    lastSeen: "Last seen",
    noAgent: "no agent",
    noAgentWarning: "This gadget has no agent, so it has nothing to say. Bind one to give it a voice.",
    claimHeading: "Add a device",
    claimLabel: "The six digits on the gadget's screen",
    claimSubmit: "Add",
    claimOk: "The device was added.",
    claimUnknown: "That code is not valid, or has already been used.",
    claimExpired: "That code has expired. Restart the gadget to show a new one.",
    claimTaken: "That gadget already has an owner.",
    claimPending: "The code was recorded. The gadget is waiting for an admin to approve it.",
    pendingHeading: "Waiting for approval",
    pendingBody:
      "Your request was recorded. The device appears in the list once an admin approves it.",
  },

  device: {
    identifier: "Device-Id",
    name: "Name",
    agent: "Agent",
    partner: "Paired with",
    lastSeen: "Last seen",
    time: "When",
    none: "none",
    rename: "Rename",
    save: "Save",
    bindAgent: "Bind an agent",
    unbindAgent: "Unbind the agent",
    pair: "Pair",
    unpair: "Unpair",
    release: "Release this gadget",
    releaseConfirm:
      "Release this gadget? It will no longer belong to your account, and its whole conversation record will be deleted.",
    turnsHeading: "Conversation",
    turnsEmpty: "Nothing has been said yet.",
    personSaid: "Person",
    gadgetSaid: "Gadget",
    saved: "Saved.",
    notFound: "That device was not found.",
    toolsHeading: "What this gadget can do",
    toolsUnknown: "Nothing has been heard from this gadget since the console was deployed.",
    toolsNone: "This gadget declares no tools of its own.",
    toolsReportedAt: "Last reported",
  },

  agents: {
    heading: "Agents",
    empty: "No agents yet. Create one to bind to a device.",
    create: "Create an agent",
    name: "Name",
    language: "Language",
    engine: "Voice engine",
    runtime: "Runtime",
    answers: "Answers",
    answersNone: "no devices",
    edit: "Edit",
  },

  llmProfiles: {
    heading: "Your LLM",
    empty: "No LLM connection yet. Add an OpenAI-compatible endpoint to have gadgets answered by your own model.",
    create: "Add a connection",
    name: "Name",
    baseUrl: "Base URL",
    model: "Model",
    temperature: "Temperature (0–2, leave empty for the provider's default)",
    apiKey: "API key",
    apiKeyKeep: "Leave empty to keep the stored key",
    save: "Save",
    created: "The connection was added.",
    saved: "Saved.",
    delete: "Delete this connection",
    deleteConfirm:
      "Delete this connection? Agents using it will fall back to the runtime's default model.",
    deleteConfirmShort: "Confirm delete (agents fall back to the default)",
    deleted: "The connection was deleted.",
    usedBy: "Used by",
    usedByNone: "no agents",
    refused: "The connection could not be saved.",
    note: "This model answers chat. Knowledge search keeps the runtime's own embedding model.",
  },

  agentForm: {
    llmProfile: "Answering model",
    llmDefault: "The runtime's default",
    name: "Name",
    systemPrompt: "System prompt",
    language: "Language",
    engine: "Voice engine",
    runtime: "Runtime",
    answerMode: "How it answers",
    answerModeGenerate: "Generate a reply",
    answerModeMaterial: "Read from the material",
    topics: "Topics (one per line)",
    save: "Save",
    create: "Create the agent",
    created: "The agent was created.",
    saved: "The agent was saved.",
    delete: "Delete this agent",
    deleteConfirm:
      "Delete this agent? Every device it answers will be left with no agent, and will say nothing until another is bound.",
    deleted: "The agent was deleted.",
    noRuntimes: "No runtime yet. Run npm run seed:runtime first.",
    refused: "The agent could not be saved.",
  },

  time: {
    never: "never",
    justNow: "just now",
    minutes: "{n} minute{plural} ago",
    hours: "{n} hour{plural} ago",
    days: "{n} day{plural} ago",
  },

  help: {
    contents: "Contents",
    cause: "Why",
    fix: "What to do",
  },

  common: {
    back: "Back",
    cancel: "Cancel",
    notFound: "Not found.",
    unexpected: "Something went wrong. Try again.",
  },
};
