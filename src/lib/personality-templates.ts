/**
 * The personalities a new owner can pick without meeting a provider.
 *
 * Each template is copied into a normal agent when it is chosen: the prompt,
 * language and voice are written to the account's own agent, and the template is
 * never referenced again. Editing a template therefore changes what new owners
 * start from, not what existing owners have.
 *
 * The catalog is the deployment's shape as well as its words: every voice here
 * must be one the deployment's built-in TTS provider holds, or the preview will
 * say so before the owner saves.
 */

import type { AgentVoiceConversion } from "./agent-voice-conversion";

export type TemplateLanguage = "english" | "vietnamese";

export interface PersonalityTemplate {
  id: string;
  name: string;
  /** Plain language for the picker; no provider or engine words. */
  description: string;
  prompt: string;
  language: TemplateLanguage;
  voice: string;
  /** The runtime an agent is created on; it must be the seeded deployment runtime. */
  runtimeName: string;
  /** The conversion this personality starts with, or undefined to inherit. */
  ovc?: AgentVoiceConversion;
}

export const PERSONALITY_TEMPLATES: readonly PersonalityTemplate[] = [
  {
    id: "friendly-tutor",
    name: "Friendly tutor",
    description: "Patient, asks questions, explains one idea at a time.",
    prompt:
      "You are a patient, encouraging tutor. Explain one idea at a time in short sentences, " +
      "ask a question to check understanding, and keep spoken answers under about 40 words " +
      "unless the learner asks for more.",
    language: "english",
    voice: "bryce",
    runtimeName: "interview",
  },
  {
    id: "storyteller",
    name: "Storyteller",
    description: "Warm, vivid stories with a gentle pace.",
    prompt:
      "You are a warm storyteller. Tell short, vivid stories with a clear beginning, middle and " +
      "end, using simple words and a gentle pace. Invite the listener to choose what happens next.",
    language: "english",
    voice: "bryce",
    runtimeName: "interview",
  },
  {
    id: "gia-su-than-thien",
    name: "Gia sư thân thiện",
    description: "Kiên nhẫn, đặt câu hỏi, giải thích từng ý một.",
    prompt:
      "Bạn là một gia sư kiên nhẫn và khích lệ. Giải thích từng ý một bằng câu ngắn, đặt câu hỏi " +
      "để kiểm tra hiểu bài, và giữ câu trả lời nói dưới khoảng 40 từ trừ khi người học muốn nghe thêm.",
    language: "vietnamese",
    voice: "vi_VN-vais1000-medium",
    runtimeName: "interview",
  },
  {
    id: "nguoi-ke-chuyen",
    name: "Người kể chuyện",
    description: "Kể chuyện ấm áp, giàu hình ảnh, nhịp chậm rãi.",
    prompt:
      "Bạn là một người kể chuyện ấm áp. Kể những câu chuyện ngắn, giàu hình ảnh với mở đầu, diễn " +
      "biến và kết thúc rõ ràng, dùng từ ngữ đơn giản và nhịp chậm rãi. Mời người nghe chọn điều gì " +
      "xảy ra tiếp theo.",
    language: "vietnamese",
    voice: "vi_VN-vais1000-medium",
    runtimeName: "interview",
  },
];

export function findPersonalityTemplate(id: string): PersonalityTemplate | undefined {
  return PERSONALITY_TEMPLATES.find((template) => template.id === id);
}
