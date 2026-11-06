import type { Guide } from "./types";

/**
 * The guide, in Vietnamese.
 *
 * Every instruction here describes what the console and the bridge actually do.
 * When one of them changes, this file changes in the same change — a guide that
 * promises a setting the product does not have is worse than no guide.
 */
export const viGuide: Guide = {
  title: "Hướng dẫn sử dụng",
  intro:
    "Từ lúc mở hộp đến lúc nói chuyện với gadget: mỗi mục dưới đây là một bước, một lỗi bạn có thể gặp, hoặc một điều nên biết trước — như ai nhìn thấy gì.",
  sections: [
    {
      id: "before",
      title: "Cần gì trước khi bắt đầu",
      blocks: [
        {
          kind: "steps",
          items: [
            "Một tài khoản trên console này. Đăng ký bằng email và mật khẩu ở trang đầu.",
            "Gadget đã được nạp firmware trỏ về bridge của bạn, và đã vào được Wi-Fi.",
            "Biết bạn muốn gadget nói tiếng Việt hay tiếng Anh — điều này chọn ở tính cách, không phải trên gadget.",
          ],
        },
        {
          kind: "note",
          text: "Gadget không kết nối trực tiếp tới console. Nó hỏi bridge để biết địa chỉ, và bridge hỏi console để biết nó thuộc về ai.",
        },
      ],
    },
    {
      id: "setup",
      title: "Thiết lập gadget của bạn",
      blocks: [
        {
          kind: "steps",
          items: [
            "Bật gadget và nhập sáu chữ số trên màn hình vào ô mã ở trang chủ. Quản trị viên sẽ duyệt yêu cầu; trong lúc chờ, trang chủ cho biết yêu cầu đang được xem xét.",
            "Chọn cách nó nói: chọn một tính cách trong danh sách, hoặc viết một câu mô tả cách nó nên nói.",
            "Nghe thử bằng “Nghe thử”, rồi lưu. Mỗi gadget chỉ có một tính cách đang dùng, và có thể đổi ngay trên thẻ của nó.",
          ],
        },
        {
          kind: "note",
          text: "Giọng nói và mô hình trả lời do hệ thống này cung cấp. Bạn không cần API key, địa chỉ endpoint hay tên mô hình.",
        },
        {
          kind: "note",
          text: "Nếu “Nghe thử” báo giọng nói bị từ chối, dịch vụ giọng nói của hệ thống không có giọng đó. Hãy chọn giọng khác hoặc nhờ quản trị viên.",
        },
      ],
    },
    {
      id: "roles",
      title: "Tài khoản, và ai nhìn thấy gì",
      blocks: [
        {
          kind: "p",
          text: "Mỗi tài khoản là user hoặc admin. Tài khoản mới là user. Quyền admin do một admin hiện có cấp ở trang Tài khoản, hoặc do người vận hành deployment cấp; console không có cách nào để tự cấp quyền cho chính mình.",
        },
        {
          kind: "p",
          text: "User chỉ thấy những gì của mình: thiết bị, các tính cách (lời nhắc, ngôn ngữ, giọng nói và cách trả lời của từng tính cách) và lịch sử hội thoại. User không cấu hình nhà cung cấp: hệ thống cung cấp giọng nói và model trả lời.",
        },
        {
          kind: "p",
          text: "Admin thấy thiết bị của mọi tài khoản — ai sở hữu, tính cách nào đang trả lời, và hội thoại — và có thể đổi tên, gán, ghép cặp hoặc giải phóng bất kỳ thiết bị nào. Admin cũng thấy mọi tài khoản kèm số thiết bị và số tính cách, duyệt các yêu cầu claim đang chờ, và quản lý nhà cung cấp tích hợp của hệ thống bằng lệnh seed.",
        },
        {
          kind: "note",
          text: "Console không bao giờ hiển thị key của nhà cung cấp trên trình duyệt. Các nhà cung cấp tích hợp là dùng chung: trang nhà cung cấp chỉ liệt kê để xem, và thay đổi chúng là một lệnh seed, không phải thao tác trên console.",
        },
        {
          kind: "note",
          text: "Admin cuối cùng không thể bị thu quyền, để khu quản trị không bị khoá chỉ vì một cú bấm. Một số deployment còn bảo vệ những tài khoản cụ thể khỏi việc mất quyền.",
        },
      ],
    },
    {
      id: "claim",
      title: "Thêm thiết bị bằng mã 6 số",
      blocks: [
        {
          kind: "p",
          text: "Một gadget mới chưa thuộc về ai. Lần đầu bật máy, nó sẽ hiện một mã 6 số trên màn hình và đọc to từng số.",
        },
        {
          kind: "steps",
          items: [
            "Bật gadget và để nó kết nối Wi-Fi.",
            "Đọc mã 6 số trên màn hình (hoặc nghe nó đọc).",
            "Mở trang chủ, nhập mã vào thẻ thêm thiết bị, bấm Thêm.",
            "Yêu cầu được ghi lại và trang chủ báo đang chờ quản trị viên duyệt. Quản trị viên duyệt thì gadget mới thuộc về bạn.",
            "Sau khi được duyệt, đánh thức gadget một lần nữa để nó kết nối, rồi chọn tính cách cho nó.",
          ],
        },
        {
          kind: "note",
          text: "Mã chỉ dùng được một lần và có hạn (mặc định 10 phút). Nếu hết hạn, tắt rồi bật lại gadget để lấy mã mới. Yêu cầu đã nhập thì chờ duyệt, không phải nhập lại.",
        },
      ],
    },
    {
      id: "agents",
      title: "Tính cách: gadget nói bằng gì",
      blocks: [
        {
          kind: "p",
          text: "Mỗi thiết bị có một tính cách đang dùng tại một thời điểm. Tính cách giữ cách nó nói — một mẫu hoặc mô tả của bạn — ngôn ngữ và giọng nói, và trong Cài đặt nâng cao là lời nhắc, runtime, cách trả lời và chủ đề. Nó trả lời bằng bộ chuyển giọng, giọng nói và model tích hợp của hệ thống; bạn không cấu hình nhà cung cấp.",
        },
        {
          kind: "steps",
          items: [
            "Vào mục Tính cách, bấm “Tạo tính cách”.",
            "Chọn điểm bắt đầu: một mẫu, hoặc “Tự nhập” và một câu mô tả cách nó nên nói.",
            "Đặt tên và chọn ngôn ngữ.",
            "Chọn một giọng mà dịch vụ giọng nói của hệ thống có.",
            "Bấm “Nghe thử” để nghe giọng trước khi lưu.",
            "Lưu lại, rồi chọn nó trên thẻ của thiết bị, hoặc bấm “Dùng tính cách này” trên thẻ.",
            "“Cài đặt nâng cao” mở lời nhắc, runtime, cách trả lời, chủ đề và chuyển giọng — và vẫn không có ô nhà cung cấp.",
          ],
        },
        {
          kind: "note",
          text: "Lời nhắc, ngôn ngữ và giọng của mẫu được sao vào tính cách của bạn; sửa mẫu sau đó không đổi những gì đã lưu. Một tính cách có thể dùng cho nhiều thiết bị, nhưng mỗi thiết bị chỉ có một tính cách đang dùng.",
        },
        {
          kind: "note",
          text: "Thiết bị chưa có tính cách sẽ không nói gì cả — nó không dùng một tính cách mặc định nào. Thẻ của nó mời bạn chọn.",
        },
        {
          kind: "note",
          text: "Topics là tên chủ đề trong kho tri thức, không phải lời dặn cho model. Mỗi nhãn được đổi thành tên kho — bỏ dấu, viết thường, khoảng trắng thành dấu gạch — nên “Truyện kiếm hiệp” thành truyen-kiem-hiep. Nhãn không khớp kho nào thì bị bỏ qua và lượt nói không tra cứu được gì, nên hãy viết đúng tên chủ đề mà kho đang có.",
        },
      ],
    },
    {
      id: "speech",
      title: "Nghe và nói: do hệ thống cung cấp",
      blocks: [
        {
          kind: "p",
          text: "Gadget nghe và nói qua dịch vụ giọng nói của hệ thống. Bạn không nhập endpoint, model hay key; tính cách chỉ chọn một giọng.",
        },
        {
          kind: "p",
          text: "Hệ thống công bố một bộ chuyển giọng và một giọng mặc định. Nếu chưa có, form tính cách báo hệ thống chưa có model hoặc giọng, và quản trị viên cần seed.",
        },
        {
          kind: "note",
          text: "“Nghe thử” dùng đúng đường tổng hợp và chuyển giọng của một lượt nói, nên nghe thử thế nào là gadget sẽ nói thế ấy.",
        },
        {
          kind: "error",
          symptom: "“Nghe thử” báo lỗi, hoặc gadget không nói gì.",
          cause:
            "Dịch vụ giọng nói của hệ thống không tới được, hoặc không có giọng bạn chọn.",
          fix: "Chọn giọng khác trong danh sách; nếu mọi giọng đều lỗi, nhờ quản trị viên kiểm tra dịch vụ giọng nói.",
        },
      ],
    },
    {
      id: "model",
      title: "Model trả lời: do hệ thống cung cấp",
      blocks: [
        {
          kind: "p",
          text: "Hệ thống cung cấp model trả lời. Tính cách không hỏi bạn endpoint hay key; nó dùng model tích hợp của hệ thống.",
        },
        {
          kind: "note",
          text: "Quản trị viên quản lý nhà cung cấp tích hợp bằng lệnh seed của hệ thống; trang nhà cung cấp chỉ liệt kê để xem. User không vào được trang đó.",
        },
        {
          kind: "error",
          symptom: "Gadget báo không kết nối được tới model, lượt nói không có câu trả lời.",
          cause:
            "Endpoint hoặc key của model trong hệ thống sai hay không tới được, hoặc chưa có model trả lời nào được công bố.",
          fix: "Nhờ quản trị viên kiểm tra model tích hợp và seed lại. Lượt nói đã cố ý không được trả lời bằng model khác.",
        },
      ],
    },
    {
      id: "talk",
      title: "Nói chuyện với gadget",
      blocks: [
        {
          kind: "p",
          text: "Đánh thức gadget bằng wake word của nó, rồi nói bình thường. Bridge tự biết khi bạn ngừng nói và gửi lượt đi; bạn không phải bấm gì.",
        },
        {
          kind: "note",
          text: "Câu trả lời được đọc qua loa của chính gadget và hiện trên màn hình của nó.",
        },
        {
          kind: "p",
          text: "Một số câu ngắn do bridge hoặc gadget tự xử lý, không gửi tới model: phát nhạc và dừng nhạc (nếu bridge có thư viện nhạc), và đổi mức âm lượng hay độ sáng màn hình (“to hơn”, “nhỏ hơn”, “sáng hơn”, “tối hơn”).",
        },
      ],
    },
    {
      id: "capabilities",
      title: "Gadget có thể làm gì",
      blocks: [
        {
          kind: "p",
          text: "Model không chỉ trả lời bằng lời. Khi bạn yêu cầu một việc, nó có thể gọi một công cụ mà gadget hoặc bridge cung cấp, rồi nói lại kết quả cho bạn nghe.",
        },
        {
          kind: "p",
          text: "Công cụ của gadget do firmware của nó khai, và mỗi board một khác: board có màn hình thì có độ sáng và giao diện hiển thị, board có camera thì có công cụ chụp ảnh, còn âm lượng và trạng thái máy thì board nào cũng có. Danh sách đúng của một máy nằm ở trang của chính nó — mục “Thiết bị này làm được”.",
        },
        {
          kind: "note",
          text: "Trang đó ghi lại danh sách máy báo ở phiên gần nhất. Máy chưa kết nối lần nào kể từ khi console được triển khai thì trang ghi là chưa nghe được.",
        },
        {
          kind: "p",
          text: "Công cụ của bridge là thư viện nhạc trên máy chạy bridge: phát một bài, dừng nhạc, và liệt kê những bài đang có để model chọn đúng tên. Nhạc phát ra loa của chính gadget. Nếu deployment không cấu hình thư viện nhạc thì ba công cụ này không tồn tại.",
        },
        {
          kind: "note",
          text: "Console không có chỗ nào để thêm hay bớt công cụ: danh sách do firmware của gadget khai và do bridge cung cấp. Gadget nào có gì thì model gọi được nấy.",
        },
        {
          kind: "note",
          text: "Gadget không khai công cụ nào cũng không sao: model vẫn trả lời bằng lời, và những câu ngắn như “to hơn”, “sáng hơn”, “phát nhạc” vẫn được xử lý như mục trên.",
        },
      ],
    },
    {
      id: "pairing",
      title: "Cho hai gadget nói chuyện với nhau",
      blocks: [
        {
          kind: "steps",
          items: [
            "Cả hai gadget phải thuộc cùng một tài khoản.",
            "Mở trang của một thiết bị, ở ô “Ghép cặp với” chọn chiếc còn lại, bấm Ghép cặp.",
            "Khi một chiếc trả lời xong, chiếc kia tiếp lời bằng chính nội dung câu trả lời đó.",
          ],
        },
        {
          kind: "note",
          text: "Wake word kết thúc cuộc đối thoại giữa hai máy. Bấm “Bỏ ghép cặp” để chúng trở lại bình thường.",
        },
      ],
    },
    {
      id: "history",
      title: "Đọc lại hội thoại",
      blocks: [
        {
          kind: "p",
          text: "Trang của mỗi thiết bị có mục “Hội thoại”: những gì bạn nói và những gì gadget đáp, mới nhất ở trên. Chỉ văn bản được lưu, không lưu âm thanh.",
        },
        {
          kind: "note",
          text: "Bản ghi được giữ theo thời hạn của deployment, và bị xoá khi bạn giải phóng thiết bị.",
        },
      ],
    },
    {
      id: "firmware",
      title: "Cập nhật firmware",
      blocks: [
        {
          kind: "p",
          text: "Firmware do quản trị viên vận hành console cài, không phải chủ thiết bị. Khi một phiên bản khác được chọn cho loại bo của thiết bị, nó sẽ cài ở lần khởi động kế tiếp.",
        },
        {
          kind: "steps",
          items: [
            "Quản trị viên tải ảnh lên và chọn nó làm bản chạy cho loại bo.",
            "Tắt rồi bật lại gadget, hoặc để nó tự khởi động lại, để nó hỏi server xem cần chạy bản nào.",
            "Gadget tải ảnh, ghi vào phân vùng không đang chạy, rồi khởi động lại lần nữa.",
            "Phiên bản mới sẽ hiện trên trang của thiết bị.",
          ],
        },
        {
          kind: "note",
          text: "Một lần cập nhật mất vài phút và gadget có thể im lặng trong lúc khởi động lại. Đừng ngắt điện trong khoảng đó.",
        },
        {
          kind: "note",
          text: "Trang thiết bị hiện phiên bản gadget đã báo và, khi khác nhau, phiên bản đang được chọn cho nó. Console không nói bản nào mới hơn: việc đó do firmware quyết định.",
        },
      ],
    },
    {
      id: "release",
      title: "Giải phóng thiết bị",
      blocks: [
        {
          kind: "p",
          text: "Giải phóng một thiết bị nghĩa là nó không còn thuộc tài khoản của bạn, và toàn bộ lịch sử hội thoại của nó bị xoá.",
        },
        {
          kind: "steps",
          items: [
            "Mở trang thiết bị, bấm “Giải phóng thiết bị” và xác nhận.",
            "Thiết bị rời khỏi danh sách.",
            "Muốn dùng lại, bật gadget để nó hiện mã mới rồi thêm lại như lần đầu.",
          ],
        },
      ],
    },
    {
      id: "errors",
      title: "Lỗi thường gặp",
      blocks: [
        {
          kind: "error",
          symptom: "Nhập mã mà console báo mã không đúng hoặc đã được dùng.",
          cause: "Mã gõ sai, hoặc mã đó đã được dùng để thêm một thiết bị trước đó.",
          fix: "Kiểm lại từng số trên màn hình gadget. Nếu mã đã dùng, thiết bị đã nằm trong danh sách của ai đó.",
        },
        {
          kind: "error",
          symptom: "Mã đã hết hạn.",
          cause: "Bạn nhập sau thời hạn của mã (mặc định 10 phút).",
          fix: "Tắt rồi bật lại gadget; nó sẽ hiện mã mới.",
        },
        {
          kind: "error",
          symptom: "Console báo thiết bị này đã có chủ.",
          cause: "Một tài khoản khác đã thêm thiết bị này trước bạn.",
          fix: "Chỉ chủ hiện tại mới giải phóng được nó. Hãy kiểm tra xem bạn đã thêm nó bằng tài khoản khác chưa.",
        },
        {
          kind: "error",
          symptom: "Đã thêm thiết bị nhưng nói vào thì gadget không trả lời.",
          cause: "Thiết bị chưa được gán tính cách, nên nó không có gì để nói.",
          fix: "Tạo hoặc chọn một tính cách rồi chọn nó trên thẻ của thiết bị.",
        },
        {
          kind: "error",
          symptom: "Đang dùng thì bị đưa về trang đăng nhập.",
          cause: "Phiên đăng nhập đã hết hạn.",
          fix: "Đăng nhập lại. Thiết bị và tính cách không bị ảnh hưởng.",
        },
      ],
    },
  ],
};
