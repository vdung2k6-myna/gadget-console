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
            "A decision about the language it should speak — Vietnamese or English. That is chosen on the agent, not on the gadget.",
          ],
        },
        {
          kind: "note",
          text: "The gadget never talks to the console directly. It asks the bridge where to connect, and the bridge asks the console who the gadget belongs to.",
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
          text: "A user sees only their own things: their devices, their agents (prompt, topics and model), their own model connection, and their conversation record.",
        },
        {
          kind: "p",
          text: "An admin sees every account's devices — who owns each one, which agent answers it, and its conversation — and can rename, bind, pair or release any of them. An admin also sees every account with a count of its devices and agents, and decides the claim requests that are waiting.",
        },
        {
          kind: "note",
          text: "An admin does not see your model connection or its key. They can see which agent answers a device and bind one of yours to it, but they cannot open or change an agent's prompt, topics or model.",
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
            "Open Devices, type the code into “The six digits on the gadget's screen”, and press Add.",
            "Your request is recorded and shown under “Waiting for approval”. The gadget belongs to you once an admin approves it.",
            "After it is approved, wake the gadget once more so it connects.",
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
      title: "Agents: what a gadget says",
      blocks: [
        {
          kind: "p",
          text: "Each gadget is answered by an agent. The agent holds the instructions the model is given, the language it is heard in, the answering model it uses, a voice of its own if you set one, and how it answers. The transcriber is the account's speech setting under Providers; an agent picks its answering model from the account's models, and may name a voice of its own instead of the account's.",
        },
        {
          kind: "steps",
          items: [
            "Open Agents and press “Create an agent”.",
            "Give it a name, and write its prompt: the instructions the model receives before everything else.",
            "Choose a runtime — where the turn is processed and answered. The languages offered below are that runtime's own.",
            "Choose the language. The transcriber is configured once for the account under Providers.",
            "Choose the “Answering model”: one of the account's models, or leave it on “The runtime's default”.",
            "Fill in “A voice of its own” if this agent should speak in a different voice from the account's. Left empty it uses the provider's voice; leaving the field checks the name against the provider.",
            "Choose how it answers: “Generate a reply” for ordinary conversation, “Read from the material” when the agent should answer from loaded documents.",
            "Fill in “Topics” if the agent should look things up: one topic per line. Left empty it looks nothing up — that is not the same as searching everything.",
            "Open your device, choose the agent you just made, and press “Bind an agent”.",
          ],
        },
        {
          kind: "note",
          text: "One agent can serve several devices. A device with no agent says nothing at all — it does not fall back to any default agent.",
        },
        {
          kind: "note",
          text: "Topics are names from the knowledge corpus, not instructions for the model. Each label is folded into a corpus name — lowercased, Vietnamese diacritics dropped, spaces turned into hyphens — so “Truyện kiếm hiệp” becomes truyen-kiem-hiep. A label that matches no corpus name is dropped and the turn looks nothing up, so write the topic names the corpus actually has.",
        },
      ],
    },
    {
      id: "speech",
      title: "The transcriber and the voice",
      blocks: [
        {
          kind: "p",
          text: "Your gadgets hear through one transcriber configured once for your account, and speak through the account's voice under Providers — unless an agent names a voice of its own.",
        },
        {
          kind: "steps",
          items: [
            "Open Providers and fill the transcriber: the endpoint and the model, and a key only if the service needs one.",
            "Fill the voice: the endpoint, the model and the voice name.",
            "Press “Hear a sample” to check the voice before a gadget uses it.",
            "Leave a form empty to use the deployment's default, or press “Use the deployment's default” to go back to it — but only when the deployment has one. A deployment that seeds no transcriber or voice has nothing behind an empty form, and the turn fails.",
          ],
        },
        {
          kind: "note",
          text: "The model and the voice are free text: `tts-1` and `alloy` are OpenAI's names, and every provider publishes its own. The endpoint defines what they mean, and the sample is how a name is checked. A deployment default only pre-fills the form and answers a kind you have not configured; when the deployment has no default for a kind, you have to fill that kind — an empty form makes the turn fail.",
        },
        {
          kind: "note",
          text: "Deleting every audio service a deployment runs takes nothing away from you: the forms still save an endpoint of your own, and a turn goes there. Nothing on this console calls a deployment audio service.",
        },
        {
          kind: "error",
          symptom: "“Hear a sample” fails, or the gadget says nothing.",
          cause:
            "The endpoint, model or voice does not answer — a wrong address, a model the service does not hold, or a voice name it does not have.",
          fix: "Check the endpoint (for a hosted provider it usually ends in /v1), the model and the voice. The sample reports the provider's own refusal.",
        },
      ],
    },
    {
      id: "model",
      title: "The answering model: the default, or your own",
      blocks: [
        {
          kind: "p",
          text: "The agent form has an “Answering model” field. Left at “The runtime's default”, the agent is answered by the model the operator configured — you need no key and pay for none of it. If the operator configured no model, there is nothing behind that choice and the turn fails; add a model of your own then.",
        },
        {
          kind: "steps",
          items: [
            "To use your own model, open Providers and, under “Answering models”, press “Add a model”.",
            "Enter the base URL of an OpenAI-compatible endpoint (for example https://api.openai.com/v1), the model, and an API key.",
            "Temperature may be left empty, to use the provider's own default.",
            "Return to the agent and choose the connection you just added in “Answering model”.",
          ],
        },
        {
          kind: "note",
          text: "The key is stored encrypted and is never shown back in a browser. Deleting a connection returns the agents using it to the runtime's default model.",
        },
        {
          kind: "error",
          symptom: "The gadget says it could not reach the model, and the turn has no answer.",
          cause:
            "The agent is using your own LLM and that endpoint did not answer — a wrong address, a network that cannot reach it, or a wrong key or model. Or the agent is on “The runtime's default” while the deployment configures no model at all.",
          fix: "Check the base URL (it usually ends in /v1), the model name, and the key; if the agent is on the default, check whether the deployment has one — if not, add a model of your own. The turn is deliberately not answered by a different model.",
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
          cause: "The device has no agent, so it has nothing to say.",
          fix: "Create or choose an agent and bind it on the device's page.",
        },
        {
          kind: "error",
          symptom: "You were sent back to the sign-in page while using it.",
          cause: "The session expired.",
          fix: "Sign in again. Devices and agents are unaffected.",
        },
      ],
    },
  ],
};
