import type { Guide } from "./types";

/** The English guide. Same sections, same ids, same order as the Vietnamese one. */
export const enGuide: Guide = {
  title: "How to use the console",
  intro:
    "From opening the box to talking to your gadget: each section is a step, a failure you might meet, or something worth knowing before you start — such as who can see what.",
  sections: [
    {
      id: "before",
      title: "What you need first",
      blocks: [
        {
          kind: "steps",
          items: [
            "An account on this console. Sign up with an email address and a password on the first screen.",
            "A gadget whose firmware points at your bridge, already joined to Wi-Fi.",
            "A decision about the language it should speak — Vietnamese or English. That is chosen on the personality, not on the gadget.",
          ],
        },
        {
          kind: "note",
          text: "The gadget never talks to the console directly. It asks the bridge where to connect, and the bridge asks the console who the gadget belongs to.",
        },
      ],
    },
    {
      id: "setup",
      title: "Setting up your gadget",
      blocks: [
        {
          kind: "steps",
          items: [
            "Turn the gadget on and type the six digits it shows into the code box on the home. An admin approves the claim; while it waits, the home says it is being reviewed.",
            "Choose how it talks: pick a personality from the list, or write a sentence describing how it should talk.",
            "Listen to the voice with “Hear it”, then save. A gadget has one active personality at a time, and its card can switch it whenever you like.",
          ],
        },
        {
          kind: "note",
          text: "The voices and the answering model are provided by this deployment. You do not need an API key, an endpoint or a model name.",
        },
        {
          kind: "note",
          text: "If “Hear it” says the voice was refused, the deployment's speech service does not hold that voice. Pick another, or ask an administrator.",
        },
      ],
    },
    {
      id: "roles",
      title: "Accounts, and who can see what",
      blocks: [
        {
          kind: "p",
          text: "Every account is either a user or an admin. A new account is a user. The role is granted by an existing admin on the Accounts page, or by whoever runs this deployment; the console offers no way to make yourself an admin.",
        },
        {
          kind: "p",
          text: "A user sees only their own things: their gadgets, their personalities — the prompt, language, voice and answer mode behind each — and their conversation record. A user does not configure providers: the deployment supplies the voices and the answering model.",
        },
        {
          kind: "p",
          text: "An admin sees every account's devices — who owns each one, which personality answers it, and its conversation — and can rename, bind, pair or release any of them. An admin also sees every account with a count of its devices and personalities, decides the claim requests that are waiting, and manages the deployment's built-in providers with the deployment's seed command.",
        },
        {
          kind: "note",
          text: "The console never shows a provider key in a browser. The deployment's built-ins are shared: the provider page lists them read-only, and changing one is a seed command, not a console action.",
        },
        {
          kind: "note",
          text: "The last admin cannot be demoted, so the admin area cannot be locked out by a click. Some deployments also protect particular accounts from losing the role.",
        },
      ],
    },
    {
      id: "claim",
      title: "Adding a device with its six-digit code",
      blocks: [
        {
          kind: "p",
          text: "A new gadget belongs to nobody. The first time it powers on, it shows a six-digit code on its screen and speaks the digits aloud.",
        },
        {
          kind: "steps",
          items: [
            "Power the gadget on and let it join Wi-Fi.",
            "Read the six digits on its screen, or listen to them.",
            "Open the home and type the code into the claim card, then press Add.",
            "Your request is recorded and the home says it is waiting for an admin's approval. The gadget belongs to you once it is approved.",
            "After it is approved, wake the gadget once more so it connects, then choose a personality for it.",
          ],
        },
        {
          kind: "note",
          text: "A code works once and expires (ten minutes by default). If it has expired, turn the gadget off and on again for a new one. A request already entered waits for approval; it does not have to be entered again.",
        },
      ],
    },
    {
      id: "agents",
      title: "Personalities: what a gadget says",
      blocks: [
        {
          kind: "p",
          text: "Each gadget has one active personality at a time. A personality holds how it talks — a template or your own description — the language and the voice, and, under Advanced, the prompt, runtime, answer mode and topics. It answers on the deployment's built-in transcriber, voice and model; you do not configure a provider.",
        },
        {
          kind: "steps",
          items: [
            "Open Personalities and press “Create a personality”.",
            "Pick a starting point: a template, or “Something else” and a sentence describing how it should talk.",
            "Give it a name and choose the language.",
            "Choose a voice the deployment's speech service holds.",
            "Press “Hear it” to hear the voice before saving.",
            "Save it, then choose it on a gadget's card, or press “Use this personality” on the card.",
            "“Advanced settings” opens the prompt, runtime, answer mode, topics and voice conversion — and still no provider field.",
          ],
        },
        {
          kind: "note",
          text: "A template's prompt, language and voice are copied into your own personality; later changes to the template do not change the ones you already saved. One personality can serve several gadgets, but each gadget has exactly one active.",
        },
        {
          kind: "note",
          text: "A gadget with no personality says nothing at all — it does not fall back to any default. Its card offers the picker.",
        },
        {
          kind: "note",
          text: "Topics are names from the knowledge corpus, not instructions for the model. Each label is folded into a corpus name — lowercased, Vietnamese diacritics dropped, spaces turned into hyphens — so “Truyện kiếm hiệp” becomes truyen-kiem-hiep. A label that matches no corpus name is dropped and the turn looks nothing up, so write the topic names the corpus actually has.",
        },
      ],
    },
    {
      id: "speech",
      title: "Hearing and speaking: provided by the deployment",
      blocks: [
        {
          kind: "p",
          text: "Your gadgets hear and speak through the deployment's speech service. You do not enter an endpoint, a model or a key; a personality only picks a voice.",
        },
        {
          kind: "p",
          text: "The deployment publishes a default transcriber and voice. If it publishes none, the personality form says the deployment has no model or voice, and an administrator must seed it.",
        },
        {
          kind: "note",
          text: "“Hear it” uses the same synthesis and voice conversion a turn uses, so what you hear is what the gadget will say.",
        },
        {
          kind: "error",
          symptom: "“Hear it” fails, or the gadget says nothing.",
          cause:
            "The deployment's speech service is unreachable, or it does not hold the voice you picked.",
          fix: "Pick another voice from the list; if every voice fails, ask an administrator to check the deployment's speech service.",
        },
      ],
    },
    {
      id: "model",
      title: "The answering model: provided by the deployment",
      blocks: [
        {
          kind: "p",
          text: "The deployment supplies the model that answers. A personality does not ask you for an endpoint or a key; it uses the deployment's built-in answering model.",
        },
        {
          kind: "note",
          text: "An administrator manages the built-in providers with the deployment's seed command; the provider page lists them read-only. A user cannot reach that page.",
        },
        {
          kind: "error",
          symptom: "The gadget says it could not reach the model, and the turn has no answer.",
          cause:
            "The deployment's answering endpoint or key is wrong or unreachable, or no answering model is published.",
          fix: "Ask an administrator to check the built-in model and re-seed it. The turn is deliberately not answered by a different model.",
        },
      ],
    },
    {
      id: "talk",
      title: "Talking to the gadget",
      blocks: [
        {
          kind: "p",
          text: "Wake the gadget with its wake word and speak normally. The bridge decides when you have finished and sends the turn; there is nothing to press.",
        },
        {
          kind: "note",
          text: "The reply is spoken through the gadget's own speaker and shown on its screen.",
        },
        {
          kind: "p",
          text: "A few short requests are handled by the bridge or the gadget itself and never reach the model: playing and stopping music (where the bridge has a music library), and changing the volume or the screen brightness (“louder”, “quieter”, “brighter”, “dimmer”).",
        },
      ],
    },
    {
      id: "capabilities",
      title: "What a gadget can be asked to do",
      blocks: [
        {
          kind: "p",
          text: "The model does not only answer in words. When you ask for something, it can call a tool that the gadget or the bridge provides, and then tell you what came of it.",
        },
        {
          kind: "p",
          text: "The gadget's own tools are declared by its firmware, and they differ by board: a board with a screen has its brightness and its themes, a board with a camera can take a photo, and every board has its volume and its status. The exact list for one gadget is on its own page, under “What this gadget can do”.",
        },
        {
          kind: "note",
          text: "That page records the list the gadget reported in its last session. A gadget that has not connected since the console was deployed shows that nothing has been heard from it yet.",
        },
        {
          kind: "p",
          text: "The bridge's tools are the music library on the machine it runs on: play a track, stop the music, and list what is there so the model can pick the right name. The music plays through the gadget's own speaker. A deployment with no music library does not have these three tools at all.",
        },
        {
          kind: "note",
          text: "There is nowhere in the console to add or remove a tool: the list comes from the gadget's firmware and from the bridge. Whatever a gadget has is what the model can call.",
        },
        {
          kind: "note",
          text: "A gadget that declares no tools is still fine: the model answers in words, and short requests such as “louder”, “brighter” or “play some music” are handled as described above.",
        },
      ],
    },
    {
      id: "pairing",
      title: "Letting two gadgets talk to each other",
      blocks: [
        {
          kind: "steps",
          items: [
            "Both gadgets must belong to the same account.",
            "Open one device, choose the other in “Paired with”, and press Pair.",
            "When one finishes a reply, the other follows with the reply's own words.",
          ],
        },
        {
          kind: "note",
          text: "The wake word ends the exchange. Press “Unpair” to return both gadgets to normal.",
        },
      ],
    },
    {
      id: "history",
      title: "Reading the conversation back",
      blocks: [
        {
          kind: "p",
          text: "Each device's page has a Conversation section: what you said and what the gadget answered, newest first. Only text is recorded — no audio.",
        },
        {
          kind: "note",
          text: "The record is kept for the deployment's retention period, and deleted when you release the gadget.",
        },
      ],
    },
    {
      id: "firmware",
      title: "Firmware updates",
      blocks: [
        {
          kind: "p",
          text: "Firmware is installed by the admin who runs this console, not by the gadget's owner. When a different version is chosen for the gadget's board type, the gadget installs it at its next boot.",
        },
        {
          kind: "steps",
          items: [
            "The admin uploads the image and marks it as the target for the board type.",
            "Power the gadget off and on, or let it restart on its own, so it asks the server what to run.",
            "The gadget downloads the image, writes it to the inactive slot, and restarts again.",
            "The version it now reports appears on its page.",
          ],
        },
        {
          kind: "note",
          text: "An update takes a few minutes and the gadget may be silent while it restarts. Do not cut its power during that time.",
        },
        {
          kind: "note",
          text: "The device page shows the version the gadget reported and, when they differ, the version targeted for it. The console does not say which is newer: that judgement belongs to the firmware.",
        },
      ],
    },
    {
      id: "release",
      title: "Releasing a gadget",
      blocks: [
        {
          kind: "p",
          text: "Releasing a gadget means it no longer belongs to your account, and its whole conversation record is deleted.",
        },
        {
          kind: "steps",
          items: [
            "Open the device and press “Release this gadget”, then confirm.",
            "The device leaves your list.",
            "To use it again, power it on so it shows a new code, then add it as you did the first time.",
          ],
        },
      ],
    },
    {
      id: "errors",
      title: "Common failures",
      blocks: [
        {
          kind: "error",
          symptom: "The console says the code is not valid, or has already been used.",
          cause: "A digit was mistyped, or that code was already used to add a device.",
          fix: "Check each digit against the gadget's screen. If the code was used, the device is already in somebody's list.",
        },
        {
          kind: "error",
          symptom: "The code has expired.",
          cause: "It was entered after its validity period (ten minutes by default).",
          fix: "Turn the gadget off and on again; it will show a new code.",
        },
        {
          kind: "error",
          symptom: "The console says that gadget already has an owner.",
          cause: "Another account added this device before you did.",
          fix: "Only its current owner can release it. Check whether you added it with a different account.",
        },
        {
          kind: "error",
          symptom: "The device was added, but it does not answer when spoken to.",
          cause: "The device has no personality, so it has nothing to say.",
          fix: "Create or choose a personality and select it on the device's card.",
        },
        {
          kind: "error",
          symptom: "You were sent back to the sign-in page while using it.",
          cause: "The session expired.",
          fix: "Sign in again. Devices and personalities are unaffected.",
        },
      ],
    },
  ],
};
