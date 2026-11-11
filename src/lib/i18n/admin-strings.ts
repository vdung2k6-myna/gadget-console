import type { Locale } from "./locales";

/**
 * The admin area's words, kept out of the shared dictionary.
 *
 * The dictionary travels to every browser in the layout's payload, so a label for
 * a page a person cannot open is a small leak of that page's existence. These
 * strings are read only on a request whose account is an admin; the shared
 * dictionary never carries them.
 */
export interface AdminStrings {
  nav: string;
  heading: string;
  devices: string;
  users: string;
  providerBuiltins: string;
  owner: string;
  tools: string;
  noOwner: string;
  noTools: string;
  viewing: string;
  role: string;
  roleUser: string;
  roleSupport: string;
  roleTenantAdmin: string;
  rolePlatformAdmin: string;
  noTenant: string;
  deviceCount: string;
  agentCount: string;
  joined: string;
  /** `{owner}` is replaced with the account's address before it is shown. */
  releaseConfirm: string;
  promote: string;
  demote: string;
  /** `{email}` is replaced with the account's address before it is shown. */
  demoteConfirm: string;
  lastAdmin: string;
  protectedAccount: string;
  roleFailed: string;
  claims: string;
  claimDevice: string;
  claimRequester: string;
  claimRequested: string;
  claimApprove: string;
  claimReject: string;
  claimRejectConfirm: string;
  claimExpired: string;
  claimTaken: string;
  claimFailed: string;
  claimsEmpty: string;
  firmware: string;
  firmwareEmpty: string;
  firmwareUpload: string;
  boardType: string;
  version: string;
  size: string;
  hash: string;
  uploader: string;
  uploadedAt: string;
  targetBadge: string;
  target: string;
  untarget: string;
  delete: string;
  forced: string;
  forcedConfirm: string;
  deleteConfirm: string;
  deleteTargeted: string;
  uploadFailed: string;
  storageUnconfigured: string;
  storageInsidePublic: string;
  publicUrlUnconfigured: string;
  inspect: string;
  inspectHeading: string;
  inspectHelp: string;
  inspectFile: string;
  inspectRun: string;
  inspectFailed: string;
  inspectTooLarge: string;
  inspectEmpty: string;
  kind: string;
  firstBytes: string;
  images: string;
  partitions: string;
  urls: string;
  notes: string;
  chip: string;
  entryPoint: string;
  flash: string;
  segments: string;
  offset: string;
  loadAddress: string;
  project: string;
  appVersion: string;
  compiled: string;
  idfVersion: string;
  elfSha: string;
  secureVersion: string;
  checksum: string;
  imageHash: string;
  label: string;
  type: string;
  subtype: string;
  valid: string;
  invalid: string;
  none: string;
  patch: string;
  patchImage: string;
  patchFind: string;
  patchApply: string;
  /** `{count}` is replaced with how many occurrences were rewritten. */
  patchMade: string;
  patchNote: string;
  patchEmpty: string;
  patchLonger: string;
  patchNotFound: string;
  patchFailed: string;
  stringsFind: string;
  stringsEdit: string;
  stringsResult: string;
  stringsTooLong: string;
  stringsEmpty: string;
  edit: string;
  addressEdit: string;
  addressAmbiguous: string;
  download: string;
  extract: string;
  saveAsRelease: string;
  saveFailed: string;
  saved: string;
  signature: string;
  unsigned: string;
  blocks: string;
  patchResign: string;
  calibration: CalibrationStrings;
  platform: PlatformStrings;
  supportAccess: SupportAccessStrings;
  audit: AuditStrings;
}

/** The calibration section's words, kept with the rest of the admin area's. */
export interface CalibrationStrings {
  heading: string;
  threshold: string;
  frames: string;
  save: string;
  reset: string;
  saved: string;
  resetDone: string;
  applies: string;
  fromDevice: string;
  fromDefault: string;
  /** `{threshold}`, `{frames}` and `{source}` are replaced before it is shown. */
  effective: string;
  /** `{threshold}` and `{frames}` are replaced before it is shown. */
  defaultLine: string;
  failed: string;
  defaultHeading: string;
  defaultHelp: string;
  defaultSave: string;
  /** `{threshold}` and `{frames}` are replaced before it is shown. */
  usingDefault: string;
}

/** The platform admin's tenants and roles area. */
export interface PlatformStrings {
  nav: string;
  heading: string;
  tenants: string;
  users: string;
  name: string;
  slug: string;
  status: string;
  plan: string;
  created: string;
  domains: string;
  accounts: string;
  deviceCount: string;
  usage: string;
  platformSeconds: string;
  resellerSeconds: string;
  allowance: string;
  billable: string;
  window: string;
  active: string;
  suspended: string;
  suspend: string;
  resume: string;
  suspendConfirm: string;
  resumeConfirm: string;
  createHeading: string;
  createHelp: string;
  nameLabel: string;
  slugLabel: string;
  localeLabel: string;
  localeVietnamese: string;
  localeEnglish: string;
  create: string;
  creating: string;
  createFailed: string;
  createTaken: string;
  empty: string;
  statusFailed: string;
  none: string;
  platformAdmins: string;
  tenant: string;
  role: string;
}

/** The platform support path to one tenant device's conversation. */
export interface SupportAccessStrings {
  heading: string;
  intro: string;
  open: string;
  opening: string;
  failed: string;
  conversation: string;
  expires: string;
  metadataOnly: string;
  device: string;
  tenant: string;
  owner: string;
  turnsEmpty: string;
}

/** The tenant's view of platform support access rows. */
export interface AuditStrings {
  heading: string;
  intro: string;
  time: string;
  actor: string;
  action: string;
  target: string;
  empty: string;
}

const ADMIN_STRINGS: Record<Locale, AdminStrings> = {
  vi: {
    nav: "Quản trị",
    heading: "Quản trị",
    calibration: {
      heading: "Hiệu chuẩn giọng nói",
      threshold: "Ngưỡng (0–1)",
      frames: "Số khung",
      save: "Lưu",
      reset: "Về mặc định",
      saved: "Đã lưu.",
      resetDone: "Đã đưa về mặc định của deployment.",
      applies: "Thay đổi có hiệu lực khi thiết bị kết nối lại.",
      fromDevice: "thiết bị này",
      fromDefault: "mặc định của deployment",
      effective: "Đang dùng {threshold} với {frames} khung — từ {source}.",
      defaultLine: "Mặc định: {threshold} / {frames}.",
      failed: "Yêu cầu không thành công.",
      defaultHeading: "Mặc định hiệu chuẩn",
      defaultHelp: "Cặp ngưỡng cho các thiết bị chưa tự hiệu chuẩn.",
      defaultSave: "Lưu mặc định",
      usingDefault: "Thiết bị chưa có cặp riêng dùng {threshold} với {frames} khung.",
    },
    platform: {
      nav: "Nền tảng",
      heading: "Quản trị nền tảng",
      tenants: "Tenant",
      users: "Tài khoản và quyền",
      name: "Tên",
      slug: "Slug",
      status: "Trạng thái",
      plan: "Gói",
      created: "Tạo lúc",
      domains: "Tên miền",
      accounts: "Tài khoản",
      deviceCount: "Thiết bị",
      usage: "Dùng trong 30 ngày",
      platformSeconds: "Giọng nói nền tảng",
      resellerSeconds: "Giọng nói reseller",
      allowance: "Hạn mức",
      billable: "Vượt hạn mức",
      window: "30 ngày gần nhất",
      active: "Đang hoạt động",
      suspended: "Tạm ngưng",
      suspend: "Tạm ngưng",
      resume: "Cho hoạt động lại",
      suspendConfirm: "Tạm ngưng {tenant}? OTA và các lượt nói sẽ bị từ chối, dữ liệu vẫn được giữ.",
      resumeConfirm: "Cho {tenant} hoạt động lại?",
      createHeading: "Tạo tenant",
      createHelp: "Tenant mới chưa có tên miền hay tài khoản nào.",
      nameLabel: "Tên hiển thị",
      slugLabel: "Slug (chữ thường, số, gạch nối)",
      localeLabel: "Ngôn ngữ mặc định",
      localeVietnamese: "Tiếng Việt",
      localeEnglish: "English",
      create: "Tạo tenant",
      creating: "Đang tạo…",
      createFailed: "Không tạo được tenant.",
      createTaken: "Slug này đã được dùng.",
      empty: "Chưa có tenant nào.",
      statusFailed: "Không đổi được trạng thái.",
      none: "chưa có",
      platformAdmins: "Quản trị nền tảng",
      tenant: "Tenant",
      role: "Quyền",
    },
    supportAccess: {
      heading: "Hỗ trợ có ghi nhận",
      intro:
        "Xem đoạn hội thoại của thiết bị này sẽ ghi lại người mở, tenant, thiết bị và thời điểm. Quản trị tenant nhìn thấy bản ghi này.",
      open: "Mở hội thoại",
      opening: "Đang mở…",
      failed: "Không mở được hội thoại.",
      conversation: "Hội thoại",
      expires: "Quyền xem hết hạn lúc",
      metadataOnly:
        "Chỉ thông tin thiết bị. Nội dung hội thoại chỉ hiện sau khi bạn mở nó bằng hành động hỗ trợ.",
      device: "Thiết bị",
      tenant: "Tenant",
      owner: "Chủ",
      turnsEmpty: "Thiết bị này chưa có lượt nói nào.",
    },
    audit: {
      heading: "Nhật ký hỗ trợ",
      intro: "Những lần nền tảng mở hội thoại của tenant này.",
      time: "Lúc",
      actor: "Người thực hiện",
      action: "Hành động",
      target: "Đối tượng",
      empty: "Chưa có lần truy cập hỗ trợ nào.",
    },
    devices: "Tất cả thiết bị",
    users: "Tài khoản",
    providerBuiltins: "Provider có sẵn",
    owner: "Chủ",
    tools: "Tool",
    noOwner: "chưa có chủ",
    noTools: "chưa báo",
    viewing: "Bạn đang xem thiết bị của",
    role: "Quyền",
    roleUser: "Người dùng",
    roleSupport: "Hỗ trợ",
    roleTenantAdmin: "Quản trị tenant",
    rolePlatformAdmin: "Quản trị nền tảng",
    noTenant: "Quản trị nền tảng không thuộc tenant nào; hãy gán tenant trước khi hạ quyền.",
    deviceCount: "Thiết bị",
    agentCount: "Agent",
    joined: "Tham gia",
    releaseConfirm:
      "Giải phóng thiết bị này? Nó thuộc về {owner}, và toàn bộ lịch sử hội thoại của họ sẽ bị xoá.",
    promote: "Cấp quyền admin",
    demote: "Thu quyền admin",
    demoteConfirm: "Thu quyền admin của {email}? Họ sẽ mất khu quản trị ngay lần truy cập sau.",
    lastAdmin: "Không thể thu quyền admin cuối cùng. Hãy cấp quyền cho một tài khoản khác trước.",
    protectedAccount: "Đây là tài khoản được bảo vệ và không thể bị thu quyền.",
    roleFailed: "Không đổi được quyền.",
    claims: "Yêu cầu claim",
    claimDevice: "Thiết bị",
    claimRequester: "Người yêu cầu",
    claimRequested: "Lúc",
    claimApprove: "Duyệt",
    claimReject: "Từ chối",
    claimRejectConfirm: "Từ chối yêu cầu này? Thiết bị sẽ có thể được người khác claim lại.",
    claimExpired: "Yêu cầu đã quá hạn duyệt.",
    claimTaken: "Thiết bị đã được người khác claim trong lúc chờ.",
    claimFailed: "Không xử lý được yêu cầu.",
    claimsEmpty: "Không có yêu cầu nào đang chờ.",
    firmware: "Firmware",
    firmwareEmpty: "Chưa có bản firmware nào.",
    firmwareUpload: "Tải lên một bản",
    boardType: "Loại bo",
    version: "Phiên bản",
    size: "Dung lượng",
    hash: "SHA-256",
    uploader: "Người tải lên",
    uploadedAt: "Tải lên lúc",
    targetBadge: "đang chọn",
    target: "Chọn làm bản chạy",
    untarget: "Bỏ chọn",
    delete: "Xoá",
    forced: "Ép buộc (cho phép hạ cấp)",
    forcedConfirm: "Chọn bản này làm bản ép buộc? Gadget sẽ cài nó kể cả khi nó cũ hơn.",
    deleteConfirm: "Xoá bản firmware này? Không thể hoàn tác.",
    deleteTargeted: "Không xoá được bản đang được chọn. Hãy bỏ chọn hoặc chọn bản khác trước.",
    uploadFailed: "Không tải lên được bản firmware.",
    storageUnconfigured: "Chưa đặt FIRMWARE_DIR nên không lưu được ảnh.",
    storageInsidePublic:
      "FIRMWARE_DIR đang nằm trong thư mục public của ứng dụng. Hãy đặt nó ra ngoài thư mục được phục vụ tĩnh.",
    publicUrlUnconfigured: "Chưa đặt CONSOLE_PUBLIC_URL nên sẽ không có bản nào được gửi tới thiết bị.",
    inspect: "Xem một tệp .bin",
    inspectHeading: "Xem tệp nhị phân",
    inspectHelp:
      "Tải lên một tệp .bin để xem loại, cấu trúc và nội dung đọc được. Tệp không được lưu lại.",
    inspectFile: "Tệp",
    inspectRun: "Đọc tệp",
    inspectFailed: "Không đọc được tệp.",
    inspectTooLarge: "Tệp lớn hơn giới hạn cho phép.",
    inspectEmpty: "Tệp rỗng.",
    kind: "Loại",
    firstBytes: "Byte đầu",
    images: "Ảnh nhúng",
    partitions: "Bảng phân vùng",
    urls: "Địa chỉ tìm thấy",
    notes: "Ghi chú",
    chip: "Chip",
    entryPoint: "Điểm vào",
    flash: "Flash",
    segments: "Phân đoạn",
    offset: "Vị trí",
    loadAddress: "Địa chỉ nạp",
    project: "Dự án",
    appVersion: "Phiên bản ứng dụng",
    compiled: "Biên dịch",
    idfVersion: "ESP-IDF",
    elfSha: "ELF SHA-256",
    secureVersion: "Secure version",
    checksum: "Checksum",
    imageHash: "SHA-256 của ảnh",
    label: "Nhãn",
    type: "Kiểu",
    subtype: "Kiểu con",
    valid: "hợp lệ",
    invalid: "không hợp lệ",
    none: "không có",
    patch: "Sửa tệp",
    patchImage: "Ảnh",
    patchFind: "Tìm",
    patchApply: "Áp dụng",
    patchMade: "Đã thay {count} chỗ.",
    patchNote:
      "Hãy khớp cả chuỗi cần thay: chuỗi thay thế ngắn hơn sẽ kết thúc chuỗi tại đó. Ảnh sau khi sửa không được ký; thiết bị có secure boot sẽ từ chối nó.",
    patchEmpty: "Chuỗi cần tìm đang trống.",
    patchLonger: "Chuỗi thay thế dài hơn chuỗi gốc nên không thể sửa tại chỗ.",
    patchNotFound: "Không tìm thấy chuỗi này trong ảnh.",
    patchFailed: "Không sửa được tệp.",
    stringsFind: "Tìm chuỗi",
    stringsEdit: "Sửa cả chuỗi",
    stringsResult: "Kết quả khi đọc",
    stringsTooLong: "Chuỗi mới dài hơn chuỗi gốc nên không thể sửa tại chỗ.",
    stringsEmpty: "Không có chuỗi nào chứa nội dung này.",
    edit: "Sửa",
    addressEdit: "Sửa địa chỉ này",
    addressAmbiguous: "Địa chỉ này nằm trong nhiều ảnh; hãy sửa trong từng ảnh.",
    download: "Tải về",
    extract: "Tải ảnh này",
    saveAsRelease: "Lưu thành bản phát hành",
    saveFailed: "Không lưu được bản phát hành.",
    saved: "Đã lưu. Mở danh sách firmware.",
    signature: "Chữ ký",
    unsigned: "không có chữ ký",
    blocks: "khối",
    patchResign:
      "Ảnh này đã có chữ ký; bản sửa không còn khớp chữ ký cũ. Hãy ký lại trước khi tải lên thiết bị.",
  },
  en: {
    nav: "Admin",
    heading: "Admin",
    calibration: {
      heading: "Speech calibration",
      threshold: "Threshold (0–1)",
      frames: "Frames",
      save: "Save",
      reset: "Reset to default",
      saved: "Saved.",
      resetDone: "Reset to the deployment default.",
      applies: "A change applies when the gadget next connects.",
      fromDevice: "this device",
      fromDefault: "the deployment default",
      effective: "Using {threshold} with {frames} frame(s) — from {source}.",
      defaultLine: "Default: {threshold} / {frames}.",
      failed: "The request failed.",
      defaultHeading: "Calibration default",
      defaultHelp: "The speech gate's pair for devices that have not calibrated their own.",
      defaultSave: "Save default",
      usingDefault: "Devices without their own pair use {threshold} with {frames} frame(s).",
    },
    platform: {
      nav: "Platform",
      heading: "Platform administration",
      tenants: "Tenants",
      users: "Accounts and roles",
      name: "Name",
      slug: "Slug",
      status: "Status",
      plan: "Plan",
      created: "Created",
      domains: "Domains",
      accounts: "Accounts",
      deviceCount: "Devices",
      usage: "Usage, last 30 days",
      platformSeconds: "Platform speech",
      resellerSeconds: "Reseller speech",
      allowance: "Allowance",
      billable: "Billable overage",
      window: "Last 30 days",
      active: "Active",
      suspended: "Suspended",
      suspend: "Suspend",
      resume: "Resume",
      suspendConfirm: "Suspend {tenant}? OTA and turns are refused; its data is kept.",
      resumeConfirm: "Resume {tenant}?",
      createHeading: "Create a tenant",
      createHelp: "A new tenant starts with no domains and no accounts.",
      nameLabel: "Display name",
      slugLabel: "Slug (lowercase letters, digits and hyphens)",
      localeLabel: "Default language",
      localeVietnamese: "Tiếng Việt",
      localeEnglish: "English",
      create: "Create tenant",
      creating: "Creating…",
      createFailed: "The tenant could not be created.",
      createTaken: "That slug is already in use.",
      empty: "No tenants yet.",
      statusFailed: "The status could not be changed.",
      none: "none",
      platformAdmins: "Platform admins",
      tenant: "Tenant",
      role: "Role",
    },
    supportAccess: {
      heading: "Audited support access",
      intro:
        "Opening this device's conversation records who opened it, the tenant, the device and the time. The tenant admin sees that record.",
      open: "Open conversation",
      opening: "Opening…",
      failed: "The conversation could not be opened.",
      conversation: "Conversation",
      expires: "Access expires",
      metadataOnly:
        "Device metadata only. Conversation text appears only after you open it through a support action.",
      device: "Device",
      tenant: "Tenant",
      owner: "Owner",
      turnsEmpty: "This device has no turns yet.",
    },
    audit: {
      heading: "Support audit",
      intro: "Occasions the platform opened a conversation for this tenant.",
      time: "When",
      actor: "Actor",
      action: "Action",
      target: "Target",
      empty: "No support access yet.",
    },
    devices: "All devices",
    users: "Accounts",
    providerBuiltins: "Provider built-ins",
    owner: "Owner",
    tools: "Tools",
    noOwner: "no owner",
    noTools: "not reported",
    viewing: "You are looking at a device belonging to",
    role: "Role",
    roleUser: "User",
    roleSupport: "Support",
    roleTenantAdmin: "Tenant admin",
    rolePlatformAdmin: "Platform admin",
    noTenant: "A platform admin has no tenant; assign a tenant before demoting it.",
    deviceCount: "Devices",
    agentCount: "Agents",
    joined: "Joined",
    releaseConfirm:
      "Release this gadget? It belongs to {owner}, and their whole conversation record will be deleted.",
    promote: "Make admin",
    demote: "Make a user",
    demoteConfirm: "Take the admin role from {email}? They lose the admin area on their next request.",
    lastAdmin: "The last admin cannot be demoted. Promote another account first.",
    protectedAccount: "This account is protected and cannot be demoted.",
    roleFailed: "The role could not be changed.",
    claims: "Claim requests",
    claimDevice: "Device",
    claimRequester: "Requested by",
    claimRequested: "When",
    claimApprove: "Approve",
    claimReject: "Refuse",
    claimRejectConfirm: "Refuse this request? The gadget becomes claimable by somebody else.",
    claimExpired: "The request expired.",
    claimTaken: "The device was claimed by somebody else while it waited.",
    claimFailed: "The request could not be handled.",
    claimsEmpty: "Nothing is waiting.",
    firmware: "Firmware",
    firmwareEmpty: "No firmware releases yet.",
    firmwareUpload: "Upload a release",
    boardType: "Board type",
    version: "Version",
    size: "Size",
    hash: "SHA-256",
    uploader: "Uploaded by",
    uploadedAt: "Uploaded",
    targetBadge: "target",
    target: "Make target",
    untarget: "Clear target",
    delete: "Delete",
    forced: "Force (allow a downgrade)",
    forcedConfirm: "Mark this release as a forced target? The gadget will install it even if it is older.",
    deleteConfirm: "Delete this firmware release? It cannot be undone.",
    deleteTargeted: "A targeted release cannot be deleted. Clear or choose another target first.",
    uploadFailed: "The release could not be uploaded.",
    storageUnconfigured: "FIRMWARE_DIR is not set, so an image cannot be stored.",
    storageInsidePublic:
      "FIRMWARE_DIR is inside the application's public directory. Move it outside anything the web server serves.",
    publicUrlUnconfigured: "CONSOLE_PUBLIC_URL is not set, so no release will be delivered to a gadget.",
    inspect: "Inspect a .bin",
    inspectHeading: "Inspect a binary",
    inspectHelp:
      "Upload a .bin to see what it is, how it is laid out, and what it contains. The file is not stored.",
    inspectFile: "File",
    inspectRun: "Read the file",
    inspectFailed: "The file could not be read.",
    inspectTooLarge: "The file is larger than the allowed limit.",
    inspectEmpty: "The file is empty.",
    kind: "Kind",
    firstBytes: "First bytes",
    images: "Embedded images",
    partitions: "Partition table",
    urls: "Addresses found",
    notes: "Notes",
    chip: "Chip",
    entryPoint: "Entry point",
    flash: "Flash",
    segments: "Segments",
    offset: "Offset",
    loadAddress: "Load address",
    project: "Project",
    appVersion: "App version",
    compiled: "Compiled",
    idfVersion: "ESP-IDF",
    elfSha: "ELF SHA-256",
    secureVersion: "Secure version",
    checksum: "Checksum",
    imageHash: "Image SHA-256",
    label: "Label",
    type: "Type",
    subtype: "Subtype",
    valid: "valid",
    invalid: "invalid",
    none: "none",
    patch: "Patch the file",
    patchImage: "Image",
    patchFind: "Find",
    patchApply: "Apply",
    patchMade: "{count} occurrence(s) replaced.",
    patchNote:
      "Match the whole string you are replacing: a shorter replacement ends it there. A patched image is not signed, and a device with secure boot enabled will refuse it.",
    patchEmpty: "The string to find is empty.",
    patchLonger: "The replacement is longer than the original, so it cannot be changed in place.",
    patchNotFound: "That string is not in the image.",
    patchFailed: "The file could not be patched.",
    stringsFind: "Find strings",
    stringsEdit: "Edit the whole string",
    stringsResult: "As it will be read",
    stringsTooLong: "The new string is longer than the original, so it cannot be changed in place.",
    stringsEmpty: "No string contains that text.",
    edit: "Edit",
    addressEdit: "Edit this address",
    addressAmbiguous: "This address is inside more than one image; edit it image by image.",
    download: "Download",
    extract: "Download this image",
    saveAsRelease: "Save as a release",
    saveFailed: "The release could not be saved.",
    saved: "Saved. Open the firmware list.",
    signature: "Signature",
    unsigned: "unsigned",
    blocks: "block(s)",
    patchResign:
      "This image was signed; the patched bytes no longer match its signature. Re-sign it before uploading to the device.",
  },
};

export function adminStringsFor(locale: Locale): AdminStrings {
  return ADMIN_STRINGS[locale];
}
