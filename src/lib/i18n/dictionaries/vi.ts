/**
 * The Vietnamese dictionary, and the shape every other one must have.
 *
 * `Strings` is derived from this object, so a key added here and forgotten in
 * another language is a compile error rather than a blank label. Functions are
 * allowed because some phrases need a number inside them ("2 phút trước").
 */
export const vi = {
  appName: "Gadget Console",

  nav: {
    devices: "Thiết bị",
    agents: "Agent",
    llmProfiles: "LLM",
    help: "Hướng dẫn",
    signOut: "Đăng xuất",
  },

  locale: {
    label: "Ngôn ngữ",
    vi: "Tiếng Việt",
    en: "English",
  },

  signIn: {
    heading: "Đăng nhập",
    subtitle: "Quản lý thiết bị XiaoZhi của bạn và những gì chúng nói.",
    email: "Email",
    password: "Mật khẩu",
    submit: "Đăng nhập",
    failed: "Email hoặc mật khẩu không đúng.",
  },

  signUp: {
    heading: "Tạo tài khoản",
    email: "Email",
    password: "Mật khẩu (ít nhất 8 ký tự)",
    submit: "Tạo tài khoản",
    failed: "Không tạo được tài khoản.",
  },

  devices: {
    heading: "Thiết bị",
    empty: "Bạn chưa có thiết bị nào. Nhập mã hiện trên màn hình gadget để thêm.",
    name: "Tên",
    agent: "Agent",
    lastSeen: "Lần cuối",
    noAgent: "chưa gán agent",
    noAgentWarning: "Thiết bị này chưa có agent nên chưa nói được. Gán agent để nó trả lời.",
    claimHeading: "Thêm thiết bị",
    claimLabel: "Mã 6 số trên màn hình gadget",
    claimSubmit: "Thêm",
    claimOk: "Đã thêm thiết bị.",
    claimUnknown: "Mã này không đúng hoặc đã được dùng.",
    claimExpired: "Mã đã hết hạn. Bật lại gadget để nó hiện mã mới.",
    claimTaken: "Thiết bị này đã có chủ.",
    claimPending: "Mã đã được ghi nhận. Thiết bị đang chờ quản trị viên duyệt.",
    pendingHeading: "Đang chờ duyệt",
    pendingBody:
      "Yêu cầu của bạn đã được ghi nhận. Thiết bị sẽ xuất hiện trong danh sách sau khi quản trị viên duyệt.",
  },

  device: {
    identifier: "Device-Id",
    name: "Tên",
    agent: "Agent",
    partner: "Ghép cặp với",
    lastSeen: "Lần cuối",
    time: "Thời điểm",
    none: "không có",
    rename: "Đổi tên",
    save: "Lưu",
    bindAgent: "Gán agent",
    unbindAgent: "Bỏ agent",
    pair: "Ghép cặp",
    unpair: "Bỏ ghép cặp",
    release: "Giải phóng thiết bị",
    releaseConfirm:
      "Giải phóng thiết bị này? Nó sẽ không còn thuộc tài khoản của bạn, và toàn bộ lịch sử hội thoại của nó sẽ bị xoá.",
    turnsHeading: "Hội thoại",
    turnsEmpty: "Chưa có lượt nói nào.",
    personSaid: "Người nói",
    gadgetSaid: "Gadget đáp",
    saved: "Đã lưu.",
    notFound: "Không tìm thấy thiết bị này.",
    toolsHeading: "Thiết bị này làm được",
    toolsUnknown: "Chưa nghe được từ thiết bị này kể từ khi console được triển khai.",
    toolsNone: "Thiết bị này không khai công cụ nào.",
    toolsReportedAt: "Cập nhật lần cuối",
  },

  agents: {
    heading: "Agent",
    empty: "Chưa có agent nào. Tạo một agent để gán cho thiết bị.",
    create: "Tạo agent",
    name: "Tên",
    language: "Ngôn ngữ",
    engine: "Giọng đọc",
    runtime: "Runtime",
    answers: "Đang trả lời",
    answersNone: "không thiết bị nào",
    edit: "Sửa",
  },

  llmProfiles: {
    heading: "LLM của bạn",
    empty: "Chưa có kết nối LLM nào. Thêm một endpoint OpenAI-compatible để gadget trả lời bằng model của bạn.",
    create: "Thêm kết nối",
    name: "Tên",
    baseUrl: "Base URL",
    model: "Model",
    temperature: "Temperature (0–2, để trống dùng mặc định)",
    apiKey: "API key",
    apiKeyKeep: "Để trống để giữ key hiện tại",
    save: "Lưu",
    created: "Đã thêm kết nối.",
    saved: "Đã lưu.",
    delete: "Xoá kết nối",
    deleteConfirm:
      "Xoá kết nối này? Các agent đang dùng nó sẽ quay về model mặc định của runtime.",
    deleteConfirmShort: "Xác nhận xoá (agent dùng nó sẽ về mặc định)",
    deleted: "Đã xoá kết nối.",
    usedBy: "Đang dùng bởi",
    usedByNone: "không agent nào",
    refused: "Không lưu được kết nối.",
    note: "Model này trả lời chat. Tìm kiếm tài liệu vẫn dùng model embedding của runtime.",
  },

  agentForm: {
    llmProfile: "Model trả lời",
    llmDefault: "Mặc định của runtime",
    name: "Tên",
    systemPrompt: "Prompt hệ thống",
    language: "Ngôn ngữ",
    engine: "Giọng đọc",
    runtime: "Runtime",
    answerMode: "Cách trả lời",
    answerModeGenerate: "Sinh câu trả lời",
    answerModeMaterial: "Đọc từ tài liệu",
    topics: "Chủ đề (mỗi dòng một chủ đề)",
    save: "Lưu",
    create: "Tạo agent",
    created: "Đã tạo agent.",
    saved: "Đã lưu agent.",
    delete: "Xoá agent",
    deleteConfirm:
      "Xoá agent này? Mọi thiết bị nó đang trả lời sẽ không còn agent, và sẽ không nói được cho tới khi bạn gán agent khác.",
    deleted: "Đã xoá agent.",
    noRuntimes: "Chưa có runtime nào. Chạy npm run seed:runtime trước.",
    refused: "Không lưu được agent.",
  },

  // Plain data with a slot for the number, because a dictionary crosses the
  // server-to-client boundary and a function cannot. `{plural}` is for the
  // languages that need it and simply absent from this one.
  time: {
    never: "chưa từng",
    justNow: "vừa xong",
    minutes: "{n} phút trước",
    hours: "{n} giờ trước",
    days: "{n} ngày trước",
  },

  help: {
    contents: "Mục lục",
    cause: "Nguyên nhân",
    fix: "Cách xử lý",
  },

  common: {
    back: "Quay lại",
    cancel: "Huỷ",
    notFound: "Không tìm thấy.",
    unexpected: "Có lỗi xảy ra. Thử lại.",
  },
};

export type Strings = typeof vi;
