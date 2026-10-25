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
    "Từ lúc mở hộp đến lúc nói chuyện với gadget: mỗi mục dưới đây là một bước, hoặc một lỗi bạn có thể gặp và cách xử lý.",
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
            "Biết bạn muốn gadget nói tiếng Việt hay tiếng Anh — điều này chọn ở agent, không phải trên gadget.",
          ],
        },
        {
          kind: "note",
          text: "Gadget không kết nối trực tiếp tới console. Nó hỏi bridge để biết địa chỉ, và bridge hỏi console để biết nó thuộc về ai.",
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
            "Vào mục Thiết bị, nhập mã vào ô “Mã 6 số trên màn hình gadget”, bấm Thêm.",
            "Yêu cầu của bạn được ghi lại và hiện dưới “Đang chờ duyệt”. Quản trị viên duyệt thì gadget mới thuộc về bạn.",
            "Sau khi được duyệt, đánh thức gadget một lần nữa để nó kết nối.",
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
      title: "Agent: gadget nói bằng gì",
      blocks: [
        {
          kind: "p",
          text: "Mỗi gadget được trả lời bởi một agent. Agent giữ những gì bạn nghe được: lời dặn cho model, ngôn ngữ, giọng đọc, và cách trả lời.",
        },
        {
          kind: "steps",
          items: [
            "Vào mục Agent, bấm “Tạo agent”.",
            "Đặt tên, và viết prompt: đây là lời dặn mà model nhận được trước mọi câu hỏi.",
            "Chọn runtime — nơi xử lý lượt nói và phát giọng. Danh sách ngôn ngữ và giọng bên dưới là của runtime đó.",
            "Chọn ngôn ngữ và giọng đọc. Giọng cụ thể do runtime quyết từ hai lựa chọn này; console không cho chọn giọng riêng.",
            "Chọn cách trả lời: “Sinh câu trả lời” cho hội thoại thường, “Đọc từ tài liệu” khi agent cần trả lời dựa trên tài liệu đã nạp.",
            "Mở thiết bị của bạn, chọn agent vừa tạo, bấm Gán agent.",
          ],
        },
        {
          kind: "note",
          text: "Một agent có thể phục vụ nhiều thiết bị. Thiết bị chưa có agent sẽ không nói gì cả — nó không dùng một agent mặc định nào.",
        },
      ],
    },
    {
      id: "model",
      title: "Model trả lời: mặc định hay của bạn",
      blocks: [
        {
          kind: "p",
          text: "Trong form agent có ô “Model trả lời”. Để “Mặc định của runtime”, agent dùng model mà nhà vận hành đã cấu hình — bạn không cần key và không phải trả tiền cho phần đó.",
        },
        {
          kind: "steps",
          items: [
            "Muốn dùng model của riêng bạn: vào mục LLM, bấm “Thêm kết nối”.",
            "Nhập base URL của endpoint OpenAI-compatible (ví dụ https://api.openai.com/v1), model, và API key.",
            "Nhiệt độ (temperature) có thể để trống để dùng mặc định của nhà cung cấp.",
            "Quay lại agent, chọn kết nối vừa tạo ở ô “Model trả lời”.",
          ],
        },
        {
          kind: "note",
          text: "Key được lưu mã hoá và không bao giờ hiện lại trên trình duyệt. Xoá một kết nối thì các agent đang dùng nó quay về model mặc định của runtime.",
        },
        {
          kind: "error",
          symptom: "Gadget báo không kết nối được tới model, lượt nói không có câu trả lời.",
          cause:
            "Agent đang dùng LLM của bạn, và endpoint đó không trả lời được — sai địa chỉ, mạng không tới, hoặc key/model không đúng.",
          fix: "Kiểm base URL (thường phải kết thúc bằng /v1), tên model, và key. Lượt nói đã cố ý không được trả lời bằng model khác.",
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
          cause: "Thiết bị chưa được gán agent, nên nó không có gì để nói.",
          fix: "Tạo hoặc chọn một agent rồi gán cho thiết bị trong trang của nó.",
        },
        {
          kind: "error",
          symptom: "Đang dùng thì bị đưa về trang đăng nhập.",
          cause: "Phiên đăng nhập đã hết hạn.",
          fix: "Đăng nhập lại. Thiết bị và agent không bị ảnh hưởng.",
        },
      ],
    },
  ],
};
