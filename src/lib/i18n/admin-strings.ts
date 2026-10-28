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
  owner: string;
  tools: string;
  noOwner: string;
  noTools: string;
  viewing: string;
  role: string;
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
}

const ADMIN_STRINGS: Record<Locale, AdminStrings> = {
  vi: {
    nav: "Quản trị",
    heading: "Quản trị",
    devices: "Tất cả thiết bị",
    users: "Tài khoản",
    owner: "Chủ",
    tools: "Tool",
    noOwner: "chưa có chủ",
    noTools: "chưa báo",
    viewing: "Bạn đang xem thiết bị của",
    role: "Quyền",
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
  },
  en: {
    nav: "Admin",
    heading: "Admin",
    devices: "All devices",
    users: "Accounts",
    owner: "Owner",
    tools: "Tools",
    noOwner: "no owner",
    noTools: "not reported",
    viewing: "You are looking at a device belonging to",
    role: "Role",
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
  },
};

export function adminStringsFor(locale: Locale): AdminStrings {
  return ADMIN_STRINGS[locale];
}
