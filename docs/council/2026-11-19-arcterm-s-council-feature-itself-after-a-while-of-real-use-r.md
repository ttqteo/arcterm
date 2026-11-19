# Council: arcterm's council feature itself, after a while of real use (rounds, seats, report, memory, Token burn gate, docs/council)

You asked: Sau 1 thời gian xài council, hãy council chính council.

## Memory

### Agreed

- Khối Council decisions trong AGENTS.md chỉ giữ luật và điều đã loại, không gắn Agreed cho việc chưa làm; việc còn phải làm thành chunk có hạn.
- Cite check khớp tên file viết trần trong các đường dẫn đầy đủ mà báo cáo đã trích, không quét đĩa; file không khớp thì đưa vào nhóm chưa kiểm.

### Ruled out

- Không ước tính chi phí council bằng trung vị của ba lần chạy. (why: Mới có ba điểm đo, và 8,7M là số của thiết kế đầu nên kéo lệch kết quả; nên lấy số lượt gọi nhân chi phí mỗi lượt từ các council xong gần nhất.)

**Council đáng giữ, nhưng phải sửa giá ước tính thấp hơn thật 3–5 lần, bỏ câu 'mở không cần hỏi', rồi lọc khối memory trong AGENTS.md.**

Bàn đồng ý council có ích, nhưng nó hứa giá thấp hơn thật nhiều lần, chép việc chưa làm thành việc đã xong, và gắn Wrong cho trích dẫn chưa kiểm. Các ý về RAM chưa có số đo nào. Bàn thiếu người hiểu Run facts và đồng hồ 5 giờ đếm token ra sao, nên chưa ai chốt hai con số có cùng đơn vị không.

## Directions

1. **Price councils from measured calls × cost per call, and stop telling agents to open one without asking** (Split)
   From P1 (Phản biện), P6 (Tìm bug), P10 (Khách).
   This puts a wrong number in front of the person on the Token burn approval card, and it spends tokens unasked. The skill promises 0.5–1.5M and says to start a council without asking (skills/council/SKILL.md:19, skills/council/SKILL.md:20). The estimate is a constant taken from a mockup (pkg/council/estimate.go:14, pkg/council/estimate_test.go:22). Finished councils report 8.7M, 4.7M and 3.9M (docs/council/2026-10-23-arcterm-s-council-feature-v1-as-shipped-the-v2-agent-team-di.md:365, docs/council/2026-11-17-sidecar-the-second-window-that-shows-the-agents-on-another-s.md:521, docs/council/2026-11-19-chat-s-suggested-replies-chatsuggest-the-fix-for-slow-and-me.md:372). Go's run of TestEstimateMatchesTheCanvas passed. That backs the contrarian's claim that the number is locked to the canvas, so the test cannot go red when a real council costs five times more. The RAM seat's challenge holds and reshapes the fix. Real councils make 1.6–1.9× the calls the formula expects, and each call costs about 2.9× more (~245k per call on the two newest councils). Fixing only one of the two still leaves the estimate at least 1.6× low. The median approach is ruled out in memory. Stances: the contrarian, the bug hunter and the new user each raised this independently; UX picked it; the RAM seat challenged only how the number is computed. The lead proposal was picked by 4 experts on 1 model. The first council flagged this on 10-23, and the skill still says the same a month later. Still open: whether Run facts counts cache reads.
   First step: Delete 'start one without asking first' from skills/council/SKILL.md:20. Then replace the 0.5–1.5M promise there, in docs/guide/council.md:32 and in the New dialog with the measured per-call cost × call count from the latest finished councils, in one commit.
   Stances: Đo RAM challenge.

2. **Filter the AGENTS.md Council decisions block to rules and ruled-out items; move pending work to dated chunks** (Agreed)
   From P3 (Phản biện), P8 (Tìm bug), P11 (Khách).
   Every agent reads this block on every run, and today it shows undone work as done. AGENTS.md:288 says the stale headless reply is dropped at once. Yet pkg/wshrpc/wshserver/wshserver_chatsuggest.go:61 still runs headless unconditionally, and the source report's 'not proven' caveat was lost in the copy (docs/council/2026-11-19-chat-s-suggested-replies-chatsuggest-the-fix-for-slow-and-me.md:14). A complaint about the wall is also tagged Agreed (AGENTS.md:296), and a sidecar line pins a commit hash (AGENTS.md:298). Memory already settles the shape: keep rules and ruled-out lines, and turn pending work into dated chunks. That rules out the status labels the new user and the bug hunter first proposed. The contrarian's challenge holds: someone has to flip a label, and nobody does. The bug hunter's challenge also holds: a 'fixed in X' line carries rules agents need while editing code. Examples are the three sidecar rules, and the ban on lowering the 10 s wait before measuring. So rewrite those lines as rules rather than dropping them. Stances: 3 experts behind it (contrarian, bug hunter, new user), on 2 models.
   First step: In pkg/council/projectdoc.go:31, stop printing commit hashes. Rewrite a 'fixed in' Agreed as the rule it protects. Open a dated chunk for the headless-reply item that AGENTS.md:288 wrongly reads as done.

3. **Cite check: resolve bare filenames against the report's own full paths, and stop calling unread lines Wrong** (Split)
   From P7 (Tìm bug), P12 (Khách).
   This shows a wrong state in every report. The 11-19 report marks 9 of 61 cites Wrong, and all 9 are 'file not found'. One of them names a file that exists in pkg/chatsuggest/ (docs/council/2026-11-19-chat-s-suggested-replies-chatsuggest-the-fix-for-slow-and-me.md:89). The cause is that a bare name is only joined to each root (pkg/council/cites.go:173, pkg/council/cites.go:193). In the other direction, a quote whose keywords are all filtered out still counts as hold (pkg/council/reportcites.go:403). Memory already settles the fix: match against the full paths the report cites, do not scan the disk, and put anything unmatched in an 'unchecked' bucket. The bug hunter's point holds: 'file not found' means the line was never read, so nobody knows yet whether any of the nine is truly wrong. UX adds a case nobody objected to: a bare name matching two cited paths needs its own 'ambiguous' label. Stances: the bug hunter and the new user proposed it; UX and the contrarian picked it. That is 4 experts on 2 models.
   First step: In pkg/council/cites.go, route a bare filename that matches no full path already cited in the report to an 'unchecked' bucket instead of Wrong. Give empty-quote holds their own label in pkg/council/reportcites.go:403.
   Stances: UX challenge.

4. **Write forward-slash paths in the AGENTS.md block so another machine's write doesn't rewrite it** (Agreed)
   From P9 (Tìm bug).
   The Report lines are written with backslashes, because nothing normalizes them (pkg/council/projectdoc.go:87, AGENTS.md:286). AGENTS.md is tracked by git, and the repo also builds on a Mac (AGENTS.md:16). One write from the other OS would churn the whole block. The bug hunter also says the block is rebuilt from the running machine's own council store (pkg/council/projectdoc.go:165). A second machine could therefore replace the block with its own list and drop the first machine's decisions from the shared file. Git history keeps them, so this is less than outright data loss, and that part is stated as 'could', not shown. The new user accepted it, and nobody challenged it. It ranks below the three above because it bites only when two machines write the block.
   First step: Convert the Report path to forward slashes in pkg/council/projectdoc.go:87 before the block is written.
   Stances: Khách accept.

5. **Score a council by whether its top direction's first step gets done, not by an instant 'Useful?'** (Split)
   From P2 (Phản biện).
   Today the only signal is the Useful button, clicked right after reading (pkg/council/store.go:303). At that point nobody knows whether the advice was right. The house example: the 10-23 council caught the 0.5–1.5M price (docs/council/2026-10-23-arcterm-s-council-feature-v1-as-shipped-the-v2-agent-team-di.md:63), and the skill still says it (skills/council/SKILL.md:19). So nothing brings a council's first step back to the person, which is why the top direction here repeats an old finding. UX's challenge holds: a chunk for every top direction would flood Needs you. Make one dated chunk for the top direction only, and ask the week-later question inside the report in Library. This fits memory's rule that pending work becomes dated chunks. Stances: the contrarian proposed it; RAM and the bug hunter picked it. That is 3 experts on 2 models.
   First step: When a report is saved, open one dated chunk for the top direction's first step, due in a week, with the Useful question asked again on that chunk.
   Stances: UX challenge.

## Also raised

- **Pick seats per question instead of the fixed four** (from P4 (Phản biện)): Seat the panel by the question, and turn the coordinator's 'panel was missing X' line into a seat suggestion for the next council. The RAM seat's challenge is to keep a floor of two seats, because the picker is the same model and costs extra calls.
- **Batch activity-only saves and skip the watcher's echo of the runner's own write** (from P21 (Đo RAM)): Each tool call rewrites the whole council file and publishes twice. Batch these to one save per 2 s, but flush on seat end or round change (UX's condition). Unmeasured.
- **Stop parsing every council file on each 10 s attention poll** (from P19 (Đo RAM)): Benchmark List first. If it is slow, have the store keep the waiting councils in memory at write time (contrarian), rather than an mtime index.
- **A slim council list for the always-mounted notifier** (from P20 (Đo RAM)): The notifier holds every full council in the page heap. Fetch only id, state and feature for it. The bug hunter warns this is unmeasured and adds a second source that can drift.
- **Add the council's held memory to RAM watch** (from P22 (Đo RAM)): Log the never-released council list with a written measuring recipe. The new user notes that the per-poll garbage and the tiny maps aren't held RAM.
- **Blind solo-opus control run** (from P5 (Phản biện)): Run one opus pass alone beside a real council, poured into the same report frame so the reader can't tell which is which. Do it once as a priced experiment first.
- **Point the guide at Library → Councils and say what Library is** (from P15 (UX), P13 (Khách)): The guide still sends readers to a sidebar section that moved to Library. The shortcut keys it would add still need checking.
- **Document the Memory tab in the guide** (from P16 (UX)): Add a Memory section and fix the tab order, but only after Agreed's meaning is fixed (contrarian).
- **Short council titles and word-boundary slugs** (from P18 (UX)): Cap titles near eight words and cut slugs at word boundaries. Keep the saved DocPath for old councils so AGENTS.md links don't break (bug hunter).
- **Saved report speaks the app's words** (from P17 (UX)): Use the app's verdict and stance words in the markdown. Keep the ids as the only key to a seat's several ideas (bug hunter), and change the AGENTS.md block's wording with it.
- **One name per seat; explain internal terms** (from P14 (Khách)): Rename so 'Điều phối' isn't two seats, and replace ids with titles in the report's From line, rather than adding a glossary (contrarian).

## Ask next

- To Đo RAM: Run facts có đếm cache read không? Đo đồng hồ 5 giờ trước và sau một council thật rồi so giúp mình.
- To Tìm bug: Dòng 'đã sửa' trong AGENTS.md đổi thành câu luật thì ai viết câu đó: Thư ký lúc tổng kết, hay mình duyệt tay?
- To Phản biện: Một lượt opus làm một mình, đổ vào đúng khung báo cáo council, thật ra tốn bao nhiêu token?


## Matrix

| Proposal | UX | Đo RAM | Khách | Tìm bug | Phản biện | Outcome |
|---|---|---|---|---|---|---|
| P1 · Giá in trên docs thấp hơn giá thật 3 đến 10 lần, mà skill lại bảo agent tự mở không cần hỏi (Ran) | — | challenge: Câu bảo agent cứ mở không cần hỏi nên bỏ ngay, mình không cãi chỗ đó. Câu đó còn đi ngược quy tắc của chính project là n… | — | — | author | Direction 1 |
| P2 · Đo sai thứ: hỏi "Useful?" lúc vừa đọc xong, không ai kiểm bước đầu có được làm không (Read code) | challenge: Mình giữ ý đo bước đầu, nhưng mỗi hướng trong top thành một chunk có hạn thì mỗi council đổ vài dòng vào Needs you, chỗ… | — | — | — | author | Direction 5 |
| P3 · Khối Council decisions trong AGENTS.md chép nguyên văn cả lịch sử, điều kiện treo lẫn lời phàn nàn, đáng ra phải lọc (Read code) | — | — | — | challenge: Mình đồng ý bỏ mã commit, nhưng không đồng ý bỏ cả dòng. Hai dòng bạn muốn đẩy ra đang chở luật mà agent cần thấy lúc sử… | author | Direction 2 |
| P4 · Bàn luôn là cùng bốn ghế, và hai báo cáo gần nhất tự nói thiếu đúng người (Read code) | — | challenge: Mình nhận một nửa. Với council hỏi về prompt gợi ý trả lời thì ghế của mình đúng là mỏng. Nhưng mình không theo chuyện b… | — | — | author | Also raised |
| P5 · Wild: đối chứng mù, một lượt opus làm một mình chạy cạnh council thật (Read code) | — | challenge: Mình sợ nó nhân đôi giá. Council thật đã tốn khoảng 4 đến 9 triệu token, và ước tính còn đang thấp hơn thật. Thêm một op… | challenge: Mình thích ý bạn, nhưng nó chưa mù thật. Báo cáo council có khung riêng, với mục Directions, nhãn Agreed hay Split và bả… | — | author | Also raised |
| P6 · Ước tính chi phí thấp hơn số thật nhiều lần (Read code) | — | challenge: Mình ủng hộ in ước tính cạnh số thật. Nhưng chỉ in hai con số thì chưa nói được sai ở đâu. Mình chia lại số của bạn theo… | — | author | — | Merged into direction 1 |
| P7 · Cite check kêu sai ở chỗ không sai, và báo đúng ở chỗ rỗng (Read code) | challenge: Mình đồng ý cả ba cách sửa. Còn thiếu một ca: tên trần khớp hai file thì chưa pass cũng chưa sai, cần nhãn riêng như "mơ… | — | — | author | — | Direction 3 |
| P8 · Agreed chép vào AGENTS.md như thể đã xong, và một dòng ghim cứng mã commit (Read code) | — | — | — | author | challenge: Bệnh thì mình đồng ý, thuốc thì mình khác. Nhãn to do hay done phải có người lật sang done, mà không ai lật thì nó lỗi t… | Merged into direction 2 |
| P9 · Khối memory ghi đường dẫn kiểu Windows vào file dùng chung (Read code) | — | — | accept: | author | — | Direction 4 |
| P10 · Giá guide hứa thấp hơn giá thật vài lần, và skill vẫn bảo cứ mở không cần hỏi (Read code) | — | challenge: Mình đồng ý ba bước, trừ việc chép ba con số vào guide. Ba số đó cũ ngay council sau, và 8,7M là của thiết kế đầu nên kh… | author | — | — | Merged into direction 1 |
| P11 · Memory trong AGENTS.md đọc như việc đã xong, trong khi code chưa đổi (Read code) | — | — | author | — | challenge: Bạn bắt đúng hai chỗ: câu «Chưa chứng minh» rơi mất khi chép, và một lời phàn nàn bị gắn Agreed. Nhưng nhãn «Đã làm ở co… | Merged into direction 2 |
| P12 · Cite check gọi tên file viết trần là Wrong, người mới đọc thành báo cáo bịa (Read code) | — | — | author | challenge: Tách nhóm riêng thì mình ủng hộ. Nhưng ==file not found nghĩa là dòng chưa từng được đọc, nên chưa ai biết trong chín ch… | — | Merged into direction 3 |
| P13 · Guide chỉ mình tới một mục sidebar có vẻ đã dời sang Library (Read code) | accept: | — | author | — | — | Withdrawn in round 2 |
| P14 · Một ghế có bốn tên, và vài chữ nội bộ chưa ai giải thích (Read code) | — | — | author | — | challenge: Khung từ vựng 8 dòng chỉ dán băng lên chỗ đặt tên trùng. Bạn đổi tên để không còn hai thứ cùng gọi là «Điều phối», và tr… | Also raised |
| P15 · Guide chỉ tới mục Councils ở sidebar, mà mục đó đã chuyển sang Library, và guide chưa nói Library là gì (Read code) | author | — | challenge: Bạn sửa đúng chỗ, nhưng người ngày đầu chưa biết Library là gì, và mình chưa thấy phím 3 hay Ctrl+G rồi o ở đâu trong ph… | — | — | Also raised |
| P16 · Tab Memory có trong app mà guide không nhắc, và guide còn đếm sai thứ tự tab (Read code) | author | — | — | — | challenge: Thêm mục Memory vào guide thì đúng. Nhưng đừng chép nguyên câu Agreed là «đã chốt, các ghế không cãi lại», vì hai đề xuấ… | Also raised |
| P17 · Báo cáo đã lưu nói bằng mã, còn app nói bằng lời (Ran) | author | — | — | challenge: Bỏ id khỏi câu thì mất khóa duy nhất. Một ghế nêu nhiều ý, ở council này Tìm bug nêu bốn, nên «From Tìm bug» không chỉ r… | — | Also raised |
| P18 · Tiêu đề council là cả một câu, nên tên file bị cắt giữa chữ (Read code) | author | — | — | challenge: Cắt ở ranh giới chữ thì được. Nhưng bạn chưa nói council cũ giữ DocPath đã lưu hay tính lại từ tiêu đề. ==Nếu tính lại t… | — | Also raised |
| P19 · Đừng parse mọi council mỗi 10 giây chỉ để tìm cái đang chờ (Read code) | — | author | — | — | challenge: Đo trước là đúng, mình đợi số của bạn. Nhưng nếu chậm thật thì đừng làm chỉ mục theo mtime. ==Store vốn là chỗ ghi mọi t… | Also raised |
| P20 · Khung luôn mounted đang giữ mọi council nguyên vẹn trong heap trang (Read code) | — | author | — | challenge: Chưa có số nào cho thấy chuyện này nặng. ==Cái tốn nhiều khả năng là mỗi lần tải lại cả list, mà phép đo heap sau GC bạn… | — | Also raised |
| P21 · Mỗi tool call ghi cả file council rồi báo hai lần (Read code) | challenge: Mình ủng hộ gộp save, vì dòng activity đổi nhanh hơn 2 giây thì mắt cũng không đọc kịp. ==Điều kiện là lần ghi cuối của… | author | — | — | — | Also raised |
| P22 · Thêm ba hàng Council vào RAM watch, mỗi hàng có công thức đo (Read code) | — | author | challenge: Danh sách council trong trang đáng ghi vì nó không bao giờ nhả, nhưng hàng parse mỗi 10 giây là rác sau mỗi lần và hàng… | — | — | Also raised |

## Cite check

Go read every `path:line` this report cites, with no model: 103 places, cited 226 times. 72 hold (the file is there, the line is in it, and a keyword of a sentence citing it is on or within 3 lines of it), 27 have no such keyword near the line, 3 are wrong, 1 are outside the folders this council reads.

Wrong:

- `chatsuggest.go:77` (Tìm bug proposes · P7): file not found
- `wshserver_chatsuggest.go:61` (Khách proposes · P11): file not found
- `chatsuggest.go:98` (Khách proposes · P12): file not found

No keyword near the line (read these by hand):

- `pkg/council/cites.go:173` (Directions; Tìm bug proposes · P7; UX has doubts · P7; Tìm bug has doubts · P12): looked for cause, joined, 19, 11, wrong, found near line 173
- `pkg/council/projectdoc.go:165` (Directions; Tìm bug proposes · P9; Khách agrees · P9; Tìm bug has doubts · P17): looked for block, rebuilt, running, machine, store, duong near line 165
- `docs/council/2026-11-19-chat-s-suggested-replies-chatsuggest-the-fix-for-slow-and-me.md:369` (Phản biện proposes · P4; Đo RAM has doubts · P4): looked for thieu, review, prompt, thiet, phieu, model near line 369
- `docs/guide/council.md:349` (Phản biện proposes · P5; Khách has doubts · P5): looked for benchmark, cites, nothing, match, challenge, shows near line 349
- `pkg/council/estimate.go:92` (Tìm bug proposes · P6; Đo RAM has doubts · P6): looked for thoai, 23, 17, 11, 19, 16 near line 92
- `pkg/council/types.go:384` (Tìm bug proposes · P8; Tìm bug has doubts · P17): looked for thuong, reply, headless, taken, sidecar, parse near line 384
- `docs/council/2026-10-23-arcterm-s-council-feature-v1-as-shipped-the-v2-agent-team-di.md:11` (Khách proposes · P10; Đo RAM has doubts · P10): looked for nguon, setup, 17, 11, 19, cache near line 11
- `AGENTS.md:283` (Khách proposes · P11): looked for 288, reply, headless, 296, tuong, quyet near line 283
- `frontend/app/view/library/librarysurface.tsx:45` (Khách proposes · P13; UX agrees · P13): looked for sidebar, withdrawn, 310, thuoc, 301 near line 45
- `docs/guide/council.md:72` (Khách proposes · P14; Phản biện has doubts · P14): looked for 72, tieng, 89, picks, 103, split near line 72
- `docs/guide/council.md:89` (Khách proposes · P14): looked for 72, tieng, 89, picks, 103, split near line 89
- `frontend/app/view/agents/councilchat.tsx:3376` (UX proposes · P16): looked for ideas, thread, skill.md, claude.md, project, ruled near line 3376
- `pkg/council/markdown.go:277` (UX proposes · P17): looked for huong, everyone, agrees, split, khach, truong near line 277
- `pkg/council/markdown.go:286` (UX proposes · P17; Tìm bug has doubts · P17): looked for huong, everyone, agrees, split, khach, truong near line 286
- `pkg/council/markdown.go:230` (UX proposes · P17): looked for huong, everyone, agrees, split, khach, truong near line 230
- `pkg/council/markdown.go:29` (UX proposes · P17): looked for huong, everyone, agrees, split, khach, truong near line 29
- `pkg/council/prompts.go:310` (UX proposes · P17): looked for huong, everyone, agrees, split, khach, truong near line 310
- `docs/council/2026-11-19-chat-s-suggested-replies-chatsuggest-the-fix-for-slow-and-me.md:7` (UX proposes · P17): looked for huong, everyone, agrees, split, khach, truong near line 7
- `pkg/council/docpath.go:42` (UX proposes · P18; Tìm bug has doubts · P18): looked for setup, placeholder, skill.md, 100, 60, and-me.md near line 42
- `skills/council/SKILL.md:47` (UX proposes · P18): looked for setup, placeholder, 100, 60, and-me.md, another-s.md near line 47
- `docs/council/2026-11-19-chat-s-suggested-replies-chatsuggest-the-fix-for-slow-and-me.md:1` (UX proposes · P18): looked for setup, placeholder, skill.md, 100, 60, and-me.md near line 1
- `pkg/jarvis/attention.go:996` (Đo RAM proposes · P19; Phản biện has doubts · P19): looked for parse, wavesrv, cache, state, project, 61 near line 996
- `frontend/app/view/agents/councilnotifysync.tsx:21` (Đo RAM proposes · P20): looked for khung, mounted, timeline, 200, thong, state near line 21
- `frontend/app/view/agents/cockpitshell.tsx:224` (Đo RAM proposes · P20): looked for khung, mounted, timeline, 200, thong, state near line 224
- `frontend/app/view/agents/councilnotifysync.tsx:43` (Đo RAM proposes · P20; Tìm bug has doubts · P20): looked for khung, mounted, timeline, 200, thong, state near line 43
- … and 2 more

Outside the council's folders (not checked):

- `C:\Users\me\AppData\Local\dev.arc.app\data\councils\4e6f5fe0f973eee2.json:3001` (Đo RAM proposes · P19): path is outside the folders this council reads

## The discussion

- **You** sets the goal
  Sau 1 thời gian xài council, hãy council chính council.
- **Phản biện** proposes · P1 · Giá in trên docs thấp hơn giá thật 3 đến 10 lần, mà skill lại bảo agent tự mở không cần hỏi
  Bốn council đã lưu cho thấy con số 0,5–1,5M token chỉ đúng với council bị dừng giữa chừng. Đây là số tự ghi trong phần Run facts của từng báo cáo:

  | Council | Docs hứa | Thật | Gấp |
  |---|---|---|---|
  | Council v1, 10-23 | 0,5–1,5M | 8,7M | ~6–17x |
  | Live agents, 10-29, dừng ở phút 3 | 0,5–1,5M | 0,5M | vừa |
  | Sidecar, 11-17 | 0,5–1,5M | 4,7M | ~3–9x |
  | Chatsuggest, 11-19 | 0,5–1,5M | 3,9M | ~3–8x |

  Ước tính lấy từ một bản mockup, và test khóa cứng nó ở 0,8M. Thẻ Token burn cũng tin luôn số đó, không sửa theo số đo. ==Nên skill mới dám nói agent cứ mở, không cần hỏi, trong khi mỗi council thật đốt khoảng 4M.== Mình đề nghị:

  1. Ước tính lấy trung vị Tokens của vài council xong gần nhất trong project, không lấy hằng số mockup.
  2. Chừng nào chưa có số đó, bỏ câu "start one without asking first" trong skill.
  3. Sửa con số trên docs, skill và hộp thoại New cùng một lần.

  Chính council đầu tiên, ngày 10-23, đã nêu chuyện này. Một tháng sau skill vẫn ghi 0,5–1,5M.
  Evidence: skills/council/SKILL.md:19; skills/council/SKILL.md:20; pkg/council/estimate.go:14; pkg/council/estimate_test.go:22; pkg/tokengate/tokengate_test.go:46; docs/council/2026-10-23-arcterm-s-council-feature-v1-as-shipped-the-v2-agent-team-di.md:365; docs/council/2026-11-17-sidecar-the-second-window-that-shows-the-agents-on-another-s.md:521; docs/council/2026-11-19-chat-s-suggested-replies-chatsuggest-the-fix-for-slow-and-me.md:372 (wrong cite: quote not found near line 372); docs/council/2026-10-29-council-with-live-agents-and-a-slack-style-council-chat.md:17; docs/council/2026-10-23-arcterm-s-council-feature-v1-as-shipped-the-v2-agent-team-di.md:63
  Check: Ran
  Verify `go test ./pkg/council -run TestEstimateMatchesTheCanvas`: passed, as its author expected
  ```text
  ok  	github.com/wavetermdev/waveterm/pkg/council	1.054s
  ```
- **Phản biện** proposes · P2 · Đo sai thứ: hỏi "Useful?" lúc vừa đọc xong, không ai kiểm bước đầu có được làm không
  Mình nghĩ mục tiêu "báo cáo hay hơn" là mục tiêu sai. Thứ đáng đo là bước đầu của hướng 1 có được làm trong tuần đó không. Hiện giờ tín hiệu duy nhất là nút Useful, bấm ngay khi đọc xong, lúc chưa ai biết lời khuyên đúng hay sai. ==Ví dụ ngay trong nhà: council ngày 10-23 đã bắt lỗi giá 0,5–1,5M, mà một tháng sau skill vẫn ghi đúng câu đó.== Không có gì đưa bước đầu quay lại với bạn. Đề nghị của mình:

  1. Mỗi hướng trong top thành một chunk có hạn, như quy tắc đo lại theo ngày bạn đã có.
  2. Chunk xong hay bị bỏ mới là điểm của council.
  3. Nút Useful giữ lại, nhưng hỏi lại sau một tuần.
  Evidence: pkg/council/store.go:303; docs/council/2026-10-23-arcterm-s-council-feature-v1-as-shipped-the-v2-agent-team-di.md:63; skills/council/SKILL.md:19
  Check: Read code
- **Phản biện** proposes · P3 · Khối Council decisions trong AGENTS.md chép nguyên văn cả lịch sử, điều kiện treo lẫn lời phàn nàn, đáng ra phải lọc
  Mỗi agent của project đọc khối này mỗi lần chạy. Nhưng nhiều dòng Agreed không phải luật để theo. Bảng dưới là các kiểu dòng mình thấy, và chỗ mỗi kiểu nên nằm:

  | Loại dòng | Ví dụ | Đi đâu |
  |---|---|---|
  | Luật cần theo | mod bỏ cuộc trước headless | giữ trong AGENTS.md |
  | Ruled out kèm lý do | | giữ trong AGENTS.md |
  | Đã sửa ở commit X | dòng sidecar kèm hash | ở lại báo cáo |
  | Chỉ làm sau khi đo | hạ 10 s khi có số | chunk có ngày |
  | Phát hiện, lời phàn nàn | tường trông giống cockpit | ở lại báo cáo |

  ==Khối này nên lọc chứ không chép: chỉ những gì agent phải tuân theo mới được vào.== Khi chép nguyên văn, câu «Chưa chứng minh» của báo cáo gốc còn rơi mất, nên dòng về reply cũ chạy headless đọc như việc đã làm xong. Lọc tốt hơn gắn nhãn trạng thái, vì nhãn cần người cập nhật mà chẳng ai cập nhật. Khối này cũng viết tiếng Việt giữa một file toàn tiếng Anh, thêm một dấu hiệu là nó chép chứ không lọc.
  Evidence: AGENTS.md:297; AGENTS.md:289; pkg/council/projectdoc.go:22; pkg/council/projectdoc.go:31
  Check: Read code
- **Phản biện** proposes · P4 · Bàn luôn là cùng bốn ghế, và hai báo cáo gần nhất tự nói thiếu đúng người
  Cả bốn council đã lưu đều ngồi đúng UX, RAM, New user và Bug hunter, vì đó là nhóm mặc định của mọi review. Một ghế RAM ngồi chấm prompt gợi ý trả lời, hay chấm chính council, là ghế dư. Còn người cần thì không có. ==Hai báo cáo liên tiếp tự ghi "Hội đồng thiếu một người": lần đầu thiếu người hiểu WebView2, lần sau thiếu người thiết kế bộ đánh giá prompt.== Thêm nữa, Run facts tự thừa nhận phiếu chọn từ cùng một model không phải phiếu độc lập. Ngược lại với cách hiện giờ:

  1. Bỏ nhóm mặc định. Một lượt gọi rẻ đọc câu hỏi rồi chọn 3–4 ghế từ thư viện vai.
  2. Nếu không vai nào hợp, nó viết một vai mới cho riêng council đó.
  3. Coordinator đã biết ai còn thiếu, nên câu "thiếu một người" nên thành gợi ý ghế cho council sau.
  Evidence: skills/council/SKILL.md:77; docs/council/2026-10-23-arcterm-s-council-feature-v1-as-shipped-the-v2-agent-team-di.md:363; docs/council/2026-11-17-sidecar-the-second-window-that-shows-the-agents-on-another-s.md:518; docs/council/2026-11-19-chat-s-suggested-replies-chatsuggest-the-fix-for-slow-and-me.md:369 (wrong cite: quote not found near line 369); docs/council/2026-11-17-sidecar-the-second-window-that-shows-the-agents-on-another-s.md:22; docs/council/2026-11-19-chat-s-suggested-replies-chatsuggest-the-fix-for-slow-and-me.md:16; docs/council/2026-11-17-sidecar-the-second-window-that-shows-the-agents-on-another-s.md:519
  Check: Read code
- **Phản biện** proposes · P5 · Wild: đối chứng mù, một lượt opus làm một mình chạy cạnh council thật
  Ý này hơi xa, nhưng mình vẫn giữ nó. Benchmark đã có biến thể solo, nhưng chỉ chạy trên case giả có đáp án, và chỉ khi gọi riêng. Trên câu hỏi thật thì chưa ai biết 4M token của council có hơn một lượt opus khoảng 0,3M không. ==Cứ năm council thì cho một lượt solo chạy cùng file, rồi bạn đọc hai bản không biết bản nào là bản nào và chọn một.== Nếu solo thắng hay hòa phần lớn, council nên chỉ mở cho câu hỏi thật sự hai phía. Chi phí thêm khoảng 7 phần trăm, đổi lại có câu trả lời cho câu hỏi đắt nhất của tính năng này.
  Evidence: docs/guide/council.md:349; docs/council/2026-11-19-chat-s-suggested-replies-chatsuggest-the-fix-for-slow-and-me.md:372 (wrong cite: quote not found near line 372); weak: The ~0.3M cost of a solo opus pass cites nothing, and the 'about 7%' does not match one solo per five councils (the new user's challenge shows ~1.5% vs ~7.5%).
  Check: Read code
- **Tìm bug** proposes · P6 · Ước tính chi phí thấp hơn số thật nhiều lần
  Guide, skill và hộp thoại đều hứa 0,5–1,5M token. Ba council đã xong thì báo số khác hẳn:

  | Council | Số lượt gọi | Token ghi ở Run facts |
  |---|---|---|
  | 23/10 | 9 | 8,7M |
  | 17/11 | 19 | 4,7M |
  | 19/11 | 16 | 3,9M |

  Công thức hiện tại cho nhóm bốn chuyên gia không file chỉ ra khoảng 0,84M và 10 lượt gọi. ==Người bấm duyệt trên thẻ Token burn đang nhìn một con số nhỏ hơn số thật vài lần.== Mình chưa chắc hai bên đo cùng đơn vị. Nên bước đầu là in ước tính cạnh số thật trong Run facts.
  Evidence: pkg/council/estimate.go:92; pkg/council/estimate.go:14; docs/council/2026-10-23-arcterm-s-council-feature-v1-as-shipped-the-v2-agent-team-di.md:365; docs/council/2026-11-17-sidecar-the-second-window-that-shows-the-agents-on-another-s.md:521; docs/council/2026-11-19-chat-s-suggested-replies-chatsuggest-the-fix-for-slow-and-me.md:372 (wrong cite: quote not found near line 372); docs/guide/council.md:32; pkg/wshrpc/wshserver/wshserver_council.go:394
  Check: Read code
- **Tìm bug** proposes · P7 · Cite check kêu sai ở chỗ không sai, và báo đúng ở chỗ rỗng
  Báo cáo 19/11 có 9 chỗ bị gắn wrong, cả 9 đều là file not found. Một trong chín là `chatsuggest.go:77`, file có thật ở `pkg/chatsuggest/`. Code chỉ nối tên trần vào từng thư mục gốc, với file đính kèm thì thư mục gốc chính là file đó, nên tên trần không bao giờ khớp. ==File not found nghĩa là dòng chưa từng được đọc, nên Wrong ở đây là «chưa kiểm», không phải «sai».==

  Chiều ngược lại cũng lỗi. Khi câu trích hết từ khóa sau khi lọc, code vẫn trả hold, nên tổng hold lẫn cả hold rỗng. ==Danh sách Wrong lẫn lỗi giả, tổng hold lẫn hold rỗng, nên người đọc học cách bỏ qua cả hai.==

  Sau khi đọc đề xuất về cite check gọi tên file viết trần là Wrong, mình đổi cách sửa. Tự khớp bằng cách quét đĩa sẽ gặp bản sao worktree cùng tên file, nên mình bỏ. Thứ tự mới:

  1. Coordinator giữ nguyên đường dẫn đầy đủ của chuyên gia.
  2. Tên trần không khớp được thì vào nhóm riêng «chưa xác định tên file», không tính Wrong.
  3. Tên trần chỉ khớp đúng một đường dẫn đầy đủ mà chính báo cáo đã trích thì lấy đường dẫn đó, rồi vẫn kiểm dòng.
  4. Hold rỗng có nhãn riêng, không tính vào hold.

  Chưa rõ tên trần do coordinator rút gọn hay do chuyên gia viết trần, nên bước 1 và bước 3 cùng giữ.
  Evidence: pkg/council/cites.go:173; pkg/council/reportcites.go:403; docs/council/2026-11-19-chat-s-suggested-replies-chatsuggest-the-fix-for-slow-and-me.md:89; docs/council/2026-11-19-chat-s-suggested-replies-chatsuggest-the-fix-for-slow-and-me.md:86
  Check: Read code
- **Tìm bug** proposes · P8 · Agreed chép vào AGENTS.md như thể đã xong, và một dòng ghim cứng mã commit
  Trong code, Agreed nghĩa là đã chốt là đúng. Nhưng thứ council chốt thường là việc còn phải làm, và khối memory chép nguyên văn vào AGENTS.md cho mọi agent đọc.

  Ví dụ, AGENTS.md ghi ca reply cũ chạy headless bị bỏ ngay. Code vẫn chạy headless vô điều kiện ngay sau nhánh mod not taken. Báo cáo gốc cũng chỉ coi đó là bước đầu chưa làm. ==Agent mở repo sẽ tin việc đã xong.== Dòng sidecar thì ghim một mã commit mà một lần viết lại lịch sử sẽ làm mất nghĩa.

  Đọc một ý khác về khối này xong, mình chỉnh cách sửa. Mình không xóa dòng nào. Mỗi Agreed mang một nhãn, và khối in nhãn đó:

  | Nhãn | Nghĩa | Khối in |
  |---|---|---|
  | rule | luật agent phải theo | câu luật |
  | todo | chốt rồi, chưa làm | câu luật kèm chữ chưa làm |
  | done | đã sửa | luật nó bảo vệ, không in mã commit |

  Mã commit ở lại báo cáo. Luật nằm trong dòng đã sửa thì ở lại AGENTS.md, vì nó chặn agent làm hỏng lại.
  Evidence: pkg/council/types.go:384; AGENTS.md:288; pkg/wshrpc/wshserver/wshserver_chatsuggest.go:61; AGENTS.md:298; pkg/council/projectdoc.go:31
  Check: Read code
- **Tìm bug** proposes · P9 · Khối memory ghi đường dẫn kiểu Windows vào file dùng chung
  Dòng Report trong khối memory ra đường dẫn với dấu gạch ngược, vì code không đổi sang dấu gạch xuôi. AGENTS.md là file git theo dõi, và repo này cũng build trên Mac. ==Một lần máy khác ghi lại khối này là cả khối đổi dấu gạch, và diff của file chỉ dẫn nổ ra mà không ai sửa gì.== Khối còn được dựng từ council trong kho của máy đang chạy. Nên máy kia có thể ghi đè khối bằng danh sách council của nó. Cách sửa nhỏ nhất là chuẩn hóa về dấu gạch xuôi trước khi ghi.
  Evidence: pkg/council/projectdoc.go:87; AGENTS.md:286; AGENTS.md:16; pkg/council/projectdoc.go:165; weak: That a second machine would overwrite the block with its own list is stated as possible, not shown.
  Check: Read code
- **Khách** proposes · P10 · Giá guide hứa thấp hơn giá thật vài lần, và skill vẫn bảo cứ mở không cần hỏi
  Mình đặt các con số cạnh nhau cho dễ thấy:

  | Nguồn | Token |
  |---|---|
  | Guide và skill nói | 0,5–1,5M |
  | Setup, nhóm 4 chuyên gia, không file | khoảng 0,8M |
  | Council 23/10, Run facts | 8,7M |
  | Council 17/11, Run facts | 4,7M |
  | Council 19/11, Run facts | 3,9M |

  Hội đồng 23/10 đã đồng ý là agent phải hỏi trước cho tới khi giá đúng, và không ai phản đối. Skill vẫn bảo mở không cần hỏi. ==Ngày đầu mình thấy 0,8M rồi đọc thấy 3,9M thì mình sẽ thôi tin cái thẻ Token burn.== Mình không biết hai bên có đếm cùng một thứ không, và chính chỗ đó cũng chưa ai nói.

  Bước đầu:

  1. Kiểm xem Run facts đếm gì, có tính cache không.
  2. Ghi con số thật của ba council gần nhất cạnh ước tính trong guide.
  3. Sửa lại dòng skill bảo mở không cần hỏi.
  Evidence: docs/guide/council.md:32; skills/council/SKILL.md:20; pkg/council/estimate.go:14; docs/council/2026-11-19-chat-s-suggested-replies-chatsuggest-the-fix-for-slow-and-me.md:372 (wrong cite: quote not found near line 372); docs/council/2026-11-17-sidecar-the-second-window-that-shows-the-agents-on-another-s.md:521; docs/council/2026-10-23-arcterm-s-council-feature-v1-as-shipped-the-v2-agent-team-di.md:11
  Check: Read code
- **Khách** proposes · P11 · Memory trong AGENTS.md đọc như việc đã xong, trong khi code chưa đổi
  Mọi mục memory đều mang nhãn Agreed, nhưng chúng gồm ba loại khác nhau. Dòng 288 nói ca reply cũ chạy headless «bị bỏ ngay». Code ở wshserver_chatsuggest.go:61 vẫn chạy headless vô điều kiện. Báo cáo gốc ghi rõ «Chưa chứng minh», mà câu đó không được chép sang AGENTS.md. Dòng 296 còn là một lời phàn nàn về cái tường, cũng bị gắn Agreed. ==Agent mới vào repo tin AGENTS.md hơn tin báo cáo, nên nó sẽ tin việc chưa làm là đã làm.==

  Mình đề xuất mỗi mục có một từ trạng thái: Quyết làm, Đã làm ở commit nào, hoặc Phát hiện. Guide cũng chưa có mục nào nói memory là gì. Muốn biết thì phải đọc skill.
  Evidence: AGENTS.md:288; AGENTS.md:296; AGENTS.md:283; pkg/wshrpc/wshserver/wshserver_chatsuggest.go:61; docs/council/2026-11-19-chat-s-suggested-replies-chatsuggest-the-fix-for-slow-and-me.md:14; skills/council/SKILL.md:197
  Check: Read code
- **Khách** proposes · P12 · Cite check gọi tên file viết trần là Wrong, người mới đọc thành báo cáo bịa
  Báo cáo ngày 19/11 ghi 9 chỗ Wrong trên 61 chỗ trích. Cả 9 chỗ đều là «file not found». Không chỗ nào là dòng sai thật. Chuyên gia trích tên trần như chatsuggest.go:98, và code chỉ ghép tên đó với thư mục gốc rồi báo không thấy, dù cùng file đó được trích đủ đường dẫn ở chỗ khác. ==Người mới thấy 9 trên 61 sẽ nghĩ báo cáo bịa gần một phần sáu.== Thật ra đó là lỗi cách viết tên.

  Mình đề xuất một trong hai cách:

  1. Tách một nhóm riêng, gọi là chưa xác định tên file.
  2. Nếu tên trần chỉ khớp đúng một file thì tự khớp.
  Evidence: docs/council/2026-11-19-chat-s-suggested-replies-chatsuggest-the-fix-for-slow-and-me.md:82 (wrong cite: quote not found near line 82); docs/council/2026-11-19-chat-s-suggested-replies-chatsuggest-the-fix-for-slow-and-me.md:88; docs/council/2026-11-19-chat-s-suggested-replies-chatsuggest-the-fix-for-slow-and-me.md:94; pkg/council/cites.go:193
  Check: Read code
- **Khách** proposes · P13 · Guide chỉ mình tới một mục sidebar có vẻ đã dời sang Library (withdrawn)
  Dòng 310 của guide nói council cũ nằm ở mục Councils đầu sidebar. AGENTS.md nói council mà cây không còn liệt kê thuộc về Library. Mình tìm trong giao diện chỉ thấy chữ Councils ở hai chỗ, là một trang lịch sử và tab của Library. Guide không nhắc chữ Library lần nào. ==Ngày đầu, bạn đóng một council rồi làm theo guide để tìm lại sẽ không thấy gì.==

  Mình đề xuất sửa dòng 301 và 310 theo chỗ thật, và thêm một câu nói Library là gì.
  Evidence: docs/guide/council.md:310; AGENTS.md:224; frontend/app/view/library/librarysurface.tsx:45
  Check: Read code
- **Khách** proposes · P14 · Một ghế có bốn tên, và vài chữ nội bộ chưa ai giải thích
  Dòng 4 gọi người tổng kết là «người điều phối». Bảng ở dòng 72 lại dùng «Điều phối» làm tên tiếng Việt của Host, một ghế khác với Thư ký. Mình đọc tới đó là rối. Mấy chữ này nữa cũng chưa được giải thích:

  1. Go làm chủ ngữ ở dòng 89. Mình không biết đó là ngôn ngữ, app hay người.
  2. picks ở dòng 103, trước đó chưa ai định nghĩa.
  3. Split và Agreed cạnh mỗi hướng trong báo cáo. Hướng 4 ghi Split mà thân bài lại nói «already agreed».
  4. P4, P11 ở dòng From, chỉ giải thích ở bảng Matrix hơn 40 dòng sau.

  ==Mình đề xuất một khung từ vựng khoảng 8 dòng ở đầu guide, và một dòng chú thích dưới tiêu đề Directions.==
  Evidence: docs/guide/council.md:4; docs/guide/council.md:72; docs/guide/council.md:89; docs/guide/council.md:103; docs/council/2026-11-19-chat-s-suggested-replies-chatsuggest-the-fix-for-slow-and-me.md:38; docs/council/2026-11-19-chat-s-suggested-replies-chatsuggest-the-fix-for-slow-and-me.md:22
  Check: Read code
- **UX** proposes · P15 · Guide chỉ tới mục Councils ở sidebar, mà mục đó đã chuyển sang Library, và guide chưa nói Library là gì
  Bạn đóng một council rồi làm theo guide để tìm lại sẽ không thấy gì. Guide bảo mở mục Councils ở đầu sidebar, mà sidebar không còn mục đó. ==Council đã rời cây giờ nằm ở Library, tab Councils, còn guide council không nhắc Library một lần nào.== Một đề xuất khác trong bàn cũng chỉ ra đúng chỗ này, và nó có thêm một ý hay: người mới chưa biết chữ Library nghĩa là gì, nên guide cần một câu giải thích. Mình đề nghị sửa bốn chỗ:

  1. Dòng 301, 308 và 310: đổi thành Library → Councils, vào bằng `Ctrl+7` rồi phím `3`, hoặc `Ctrl+G` rồi `o`.
  2. Thêm một câu gần dòng 301: Library giữ những gì đã xong, gồm ba tab Conversations, Canvases và Councils.
  3. Dòng 8: bỏ cách so với Conversation History, vì mục đó cũng đã sang Library.
  4. Thêm link Library vào dòng các trang liên quan.
  Evidence: docs/guide/council.md:310; docs/guide/council.md:8; docs/guide/agent.md:187; docs/guide/agent.md:490; weak: The Library shortcuts it would write into the guide (key 3, Ctrl+G then o) cite no binding; the new user could not find them.
  Check: Read code
- **UX** proposes · P16 · Tab Memory có trong app mà guide không nhắc, và guide còn đếm sai thứ tự tab
  Rail bên phải có ba tab là Ideas, Memory và Thread. Guide chỉ tả Ideas và Thread, và ghi Thread là tab thứ hai. Người đọc sẽ tìm sai chỗ. ==Memory là thứ các ghế coi như đã chốt, và SKILL.md nói nó còn được chép vào CLAUDE.md của project, vậy mà guide không giải thích nó.== Chấm nhỏ trên tab cũng không có lời giải thích nào trong guide. Mình đề nghị thêm một mục Memory, với bốn loại lấy nguyên từ app:

  | Loại | Nghĩa |
  |---|---|
  | Direction | Việc council sẽ làm, các ghế theo nó trước Report |
  | Agreed | Đã chốt, các ghế không cãi lại |
  | Ruled out | Đã bỏ, không quay lại nếu chưa có gì mới |
  | Open | Còn phải chốt, các ghế làm tiếp |

  Thêm một câu nói chấm trên tab nghĩa là có đề xuất hoặc hướng đang chờ bạn.
  Evidence: docs/guide/council.md:136; frontend/app/view/agents/councilchat.tsx:3367; frontend/app/view/agents/councilchat.tsx:3376; frontend/app/view/agents/councilmemorymodel.ts:73; skills/council/SKILL.md:197
  Check: Read code
- **UX** proposes · P17 · Báo cáo đã lưu nói bằng mã, còn app nói bằng lời
  Cùng một hướng, màn Report và file trong docs/council nói khác nhau. Bảng này đặt hai bên cạnh nhau:

  | Chỗ | App | File đã lưu |
  |---|---|---|
  | Kết luận | Everyone agrees | Agreed hoặc Split |
  | Ai nêu | không hiện id | From P4 (Khách), P11 (UX) |
  | Lập trường | Tìm bug has doubts | Tìm bug challenge |

  ==Chữ Agreed còn là tiêu đề của Memory, nên một file có hai Agreed không liên quan nhau.== Agent đọc đúng bản markdown này rồi tóm tắt lại cho bạn. Mình đề nghị:

  1. Viết kết luận và lập trường bằng lời của app.
  2. Dẫn tên người nêu trước, id P chỉ nằm ở cột Matrix.
  3. Đặt câu trả lời in đậm ngay dưới tiêu đề, trước khối Memory.
  Evidence: pkg/council/markdown.go:271; pkg/council/markdown.go:277; pkg/council/markdown.go:286; pkg/council/markdown.go:230; pkg/council/markdown.go:29; frontend/app/view/agents/councilsummarymodel.ts:241; frontend/app/view/agents/councilsummarymodel.ts:243; pkg/council/prompts.go:310; docs/council/2026-11-19-chat-s-suggested-replies-chatsuggest-the-fix-for-slow-and-me.md:21; docs/council/2026-11-19-chat-s-suggested-replies-chatsuggest-the-fix-for-slow-and-me.md:7
  Check: Ran
  Verify `go test ./pkg/council -run TestMarkdown`: passed, as its author expected
  ```text
  ok  	github.com/wavetermdev/waveterm/pkg/council	0.891s
  ```
- **UX** proposes · P18 · Tiêu đề council là cả một câu, nên tên file bị cắt giữa chữ
  Tiêu đề lấy từ dòng đầu của ô Setup. Placeholder nói dòng đầu là tên, nhưng không nói ngắn cỡ nào, và SKILL.md cũng không nói. Council mới nhất có tiêu đề hơn 100 ký tự. Tên file bị cắt ở 60 ký tự, ngay giữa chữ. Ba trong bốn file ở docs/council kết thúc kiểu `-and-me.md` hay `-another-s.md`. ==Người tìm lại báo cáo qua tên file không đọc ra nó nói về gì.== Mình đề nghị:

  1. Placeholder và SKILL.md nói tên dài tối đa tám chữ, phần còn lại vào câu hỏi.
  2. Cắt slug ở ranh giới chữ, không cắt giữa chữ.
  3. Bỏ dấu nháy khi tạo slug, để `Chat's` không thành `chat-s`.
  Evidence: pkg/council/docpath.go:24; pkg/council/docpath.go:42; frontend/app/view/agents/councilsetup.tsx:909; skills/council/SKILL.md:47; docs/council/2026-11-19-chat-s-suggested-replies-chatsuggest-the-fix-for-slow-and-me.md:1
  Check: Read code
- **Khách** has doubts · on P5 · Wild: đối chứng mù, một lượt opus làm một mình chạy cạnh council thật
  Mình thích ý bạn, nhưng nó chưa mù thật. Báo cáo council có khung riêng, với mục Directions, nhãn Agreed hay Split và bảng Matrix. Một bản opus làm một mình sẽ là khối chữ phẳng, nên ai đọc cũng đoán ra bản nào là bản nào. ==Muốn mù thật thì bản solo phải được đổ vào đúng khung báo cáo đó, không thì bạn đang so hình thức chứ chưa so nội dung.== Chỗ thứ hai là con số. Bạn ghi thêm khoảng 7 phần trăm, mà cách chạy bạn đề ra cho ra số khác:

  | Cách chạy | Token thêm | Tỉ lệ |
  |---|---|---|
  | Một solo cho năm council | 0,3M trên khoảng 20M | khoảng 1,5% |
  | Một solo cho mỗi council | 0,3M trên khoảng 4M | khoảng 7,5% |

  Con 7% khớp với chạy solo mỗi lần, không khớp với một trên năm. Hoặc bạn tính nhầm, hoặc giá solo cao hơn 0,3M. Bạn nói rõ giúp mình, vì người mới không biết nên tin số nào. Báo cáo ngày 19/11 cũng dài ít nhất 372 dòng, nên đọc hai bản là tốn công người đọc, chứ không chỉ tốn token.
  Evidence: docs/guide/council.md:349; docs/council/2026-11-19-chat-s-suggested-replies-chatsuggest-the-fix-for-slow-and-me.md:372; docs/council/2026-11-19-chat-s-suggested-replies-chatsuggest-the-fix-for-slow-and-me.md:22; docs/council/2026-11-19-chat-s-suggested-replies-chatsuggest-the-fix-for-slow-and-me.md:38
  Check: Read code
- **Khách** agrees · on P9 · Khối memory ghi đường dẫn kiểu Windows vào file dùng chung
  Evidence: pkg/council/projectdoc.go:87; AGENTS.md:286; AGENTS.md:16; pkg/council/projectdoc.go:165
  Check: Read code
- **Đo RAM** proposes · P19 · Đừng parse mọi council mỗi 10 giây chỉ để tìm cái đang chờ
  Cứ 10 giây trang hỏi attention một lần, và mỗi lần wavesrv đọc rồi parse từng file council, không có cache. Chỗ gọi nào cần gì thì như sau.

  | Chỗ gọi List | Khi nào | Thật sự cần |
  |---|---|---|
  | attention | mỗi 10 giây | council đang chờ bạn |
  | quét lúc khởi động | một lần | state và project |
  | danh sách của trang | khi mở | cả council |

  ==Chỉ dòng đầu chạy mãi, mà nó trả giá của dòng cuối.== Máy này có 61 file và 111 nghìn dòng JSON, số byte mình chưa đo. Mình sẽ chạy benchmark List với -benchmem trên bản sao thư mục councils, rồi so với một chỉ mục theo mtime và size.
  Evidence: frontend/app/view/agents/attentionpoller.tsx:28; pkg/jarvis/attention.go:996; pkg/jarvis/attention.go:511; pkg/council/store.go:387; C:\Users\me\AppData\Local\dev.arc.app\data\councils\4e6f5fe0f973eee2.json:3001 (wrong cite: path is outside the folders this council reads); weak: Its size evidence is a file in the user's AppData, outside the project, and the bytes parsed per poll are unmeasured.
  Check: Read code
- **Đo RAM** proposes · P20 · Khung luôn mounted đang giữ mọi council nguyên vẹn trong heap trang
  Khung luôn mounted đọc danh sách mọi council, mà mỗi council mang cả thảo luận và timeline tới 200 dòng mỗi seat. Cái thông báo cần chỉ là id, state và feature. Trang đang giữ ba lớp.

  1. Một mảng Council đầy đủ của mọi project, vì lệnh list trả cả struct.
  2. Thêm Map của lần trước trong prev, nên council vừa đổi còn hai bản.
  3. Có thể thêm một bản riêng cho mỗi project có list, vì mỗi RPC trả object mới.

  ==Cả ba lớn theo số council đã lưu và không có trần nào.== Mình đề nghị một lệnh list gọn cho khung, còn council đầy đủ chỉ nạp cho cái đang mở. Để đo, mình lấy heap JS sau GC qua CDP, mở app với và không có list, như hàng Transcript tab đã làm.
  Evidence: frontend/app/view/agents/councilnotifysync.tsx:21; frontend/app/view/agents/cockpitshell.tsx:224; frontend/app/view/agents/councilnotifysync.tsx:43; frontend/app/view/agents/councilstore.ts:176; pkg/wshrpc/wshserver/wshserver_council.go:184; pkg/council/types.go:217; weak: That the three copies grow with no cap and matter is unmeasured; the bug hunter notes heap-after-GC would miss the reload cost.
  Check: Read code
- **Đo RAM** proposes · P21 · Mỗi tool call ghi cả file council rồi báo hai lần
  Mỗi tool call của một seat đều đi một vòng ghi cả file, và folder watch báo thêm một lần cho chính cú ghi đó. Đây là một tool event.

  ```mermaid
  flowchart TD
  A["tool event"] --> B["read + parse whole file"]
  B --> C["marshal + write whole file"]
  C --> D["publish 1"]
  C --> E["watch sees the write"]
  E --> F["300 ms, read file again"]
  F --> G["publish 2"]
  D --> H["page fetches whole council"]
  G --> H
  ```

  ==Một call vòng 1 từng có 16 tool call, nên bốn seat là 64 lần ghi cả file và tới 128 lần trang tải cả council.== Đây là rác tạm, nhưng RAM watch đã ghi renderer trả bộ nhớ chậm khi bị ghi liên tục. Mình đề nghị gộp save chỉ đổi activity thành một save mỗi 2 giây, và để watch bỏ qua cú ghi của chính runner. Để đo, mình đếm council:changed và byte của CouncilGetCommand trong một council thật.
  Evidence: pkg/council/runner.go:1016; pkg/council/runner.go:1020; pkg/council/store.go:225; pkg/council/store.go:181; pkg/council/watch.go:105; pkg/wshrpc/wshserver/wshserver_council.go:94; frontend/app/view/agents/councilstore.ts:111; docs/open-issues.md:330; weak: 'A round-1 call once had 16 tool calls' cites no report or log.
  Check: Read code
- **Đo RAM** proposes · P22 · Thêm ba hàng Council vào RAM watch, mỗi hàng có công thức đo
  Hàng Council trong RAM watch chỉ đo tiến trình claude của vòng 1. Phần còn lại của vòng đời chưa có dòng nào, nên mình lập bảng ai giữ gì.

  | Cái được giữ | Chủ | Nhả khi nào | Trong RAM watch |
  |---|---|---|---|
  | claude mỗi call | runner | call xong | có |
  | Council[] trong heap trang | councilListAtom | không bao giờ | chưa |
  | parse mọi file mỗi 10 giây | attention poll | rác sau mỗi lần | chưa |
  | map locks và seen | store, councilDocs | không bao giờ | chưa, rất nhỏ |

  ==Mình đề nghị viết thêm ba hàng theo bảng này, mỗi hàng có công thức đo và ngày đo lại.== Comment ở caller.go vẫn nói sẽ ghi vào RAM watch khi đo xong, mà đã đo từ 18/11.
  Evidence: docs/open-issues.md:330; pkg/council/caller.go:61; pkg/council/store.go:44; pkg/wshrpc/wshserver/wshserver_councildoc.go:25; weak: Promises a measuring formula per row but gives none, and cites no code for the council list never being released.
  Check: Read code
- **Tìm bug** has doubts · on P3 · Khối Council decisions trong AGENTS.md chép nguyên văn cả lịch sử, điều kiện treo lẫn lời phàn nàn, đáng ra phải lọc
  Mình đồng ý bỏ mã commit, nhưng không đồng ý bỏ cả dòng. Hai dòng bạn muốn đẩy ra đang chở luật mà agent cần thấy lúc sửa code:

  | Dòng | Bạn cho đi đâu | Bỏ khỏi file thì mất gì |
  |---|---|---|
  | Đã sửa ở commit của sidecar | chỉ ở báo cáo | ba luật: agent đang hỏi luôn hiện kể cả khi lọc; phím 1–9 bị từ chối khi ask đã đổi; cửa sổ scale cao vẫn hiện tường dưới 1100 CSS px |
  | Chỉ hạ 10 s sau khi có số đo | chunk có hạn | lời cấm hạ 10 s khi chưa đo |

  Báo cáo sidecar dài hơn 500 dòng, nên ba luật kia chìm trong đó và không agent nào mở ra tìm. ==Chunk có hạn chỉ gọi người trong Needs you đúng ngày, nó không chặn agent đang sửa số 10 s hôm nay.== Bảng của bạn cũng tự đụng nhau, vì dòng chỉ làm sau khi đo đọc được như một lời cấm kèm lý do, đúng hàng bạn giữ. Mình sẽ giữ cả hai dòng, bỏ mã commit, và thêm chunk có hạn chứ không thay bằng chunk. Chuyện tiếng Việt thì mình chưa thấy nó gây lỗi nào, nên để ngoài.
  Evidence: AGENTS.md:298; AGENTS.md:289; docs/council/2026-11-17-sidecar-the-second-window-that-shows-the-agents-on-another-s.md:521
  Check: Read code
- **Tìm bug** revises it · on P8 · Agreed chép vào AGENTS.md như thể đã xong, và một dòng ghim cứng mã commit
  New title: Agreed chép vào AGENTS.md như thể đã xong, và một dòng ghim cứng mã commit. Thêm hai chỉnh sau khi đọc ý đề nghị lọc khối: bỏ mã commit nhưng giữ luật trong dòng đã sửa, và gắn nhãn thay vì xóa dòng.
- **UX** has doubts · on P2 · Đo sai thứ: hỏi "Useful?" lúc vừa đọc xong, không ai kiểm bước đầu có được làm không
  Mình giữ ý đo bước đầu, nhưng mỗi hướng trong top thành một chunk có hạn thì mỗi council đổ vài dòng vào Needs you, chỗ chỉ nên chứa việc chờ bạn quyết. Mình đề nghị một chunk cho hướng số 1 thôi, còn câu hỏi một tuần sau nằm ngay trong báo cáo ở Library.
  Evidence: pkg/jarvis/attention.go; pkg/council/store.go:303
  Check: Read code
- **UX** has doubts · on P7 · Cite check kêu sai ở chỗ không sai, và báo đúng ở chỗ rỗng
  Mình đồng ý cả ba cách sửa. Còn thiếu một ca: tên trần khớp hai file thì chưa pass cũng chưa sai, cần nhãn riêng như "mơ hồ", không thì danh sách Wrong vẫn còn lẫn.
  Evidence: pkg/council/cites.go:173; docs/council/2026-11-19-chat-s-suggested-replies-chatsuggest-the-fix-for-slow-and-me.md:89
  Check: Read code
- **UX** agrees · on P13 · Guide chỉ mình tới một mục sidebar có vẻ đã dời sang Library
  Evidence: docs/guide/council.md:310; frontend/app/view/library/librarysurface.tsx:45
  Check: Read code
- **UX** revises it · on P15 · Guide chỉ tới mục Councils ở sidebar, mà mục đó đã chuyển sang Library, và guide chưa nói Library là gì
  New title: Guide chỉ tới mục Councils ở sidebar, mà mục đó đã chuyển sang Library, và guide chưa nói Library là gì. Gộp thêm câu giải thích Library là gì, lấy từ đề xuất về mục sidebar đã dời, vì người mới chưa biết chữ này.
- **Khách** has doubts · on P15 · Guide chỉ tới mục Councils ở sidebar, mà mục đó đã chuyển sang Library, và guide chưa nói Library là gì
  Bạn sửa đúng chỗ, nhưng người ngày đầu chưa biết Library là gì, và mình chưa thấy phím 3 hay Ctrl+G rồi o ở đâu trong phần mình đọc, nên thêm một câu giải thích Library và kiểm hai phím đó trước khi ghi vào guide.
  Evidence: docs/guide/council.md:310; docs/guide/agent.md:187; AGENTS.md:224
  Check: Read code
- **Khách** has doubts · on P22 · Thêm ba hàng Council vào RAM watch, mỗi hàng có công thức đo
  Danh sách council trong trang đáng ghi vì nó không bao giờ nhả, nhưng hàng parse mỗi 10 giây là rác sau mỗi lần và hàng map bạn tự ghi là rất nhỏ, nên hai hàng đó không phải RAM bị giữ lại. Và bạn hứa công thức đo mà chưa viết công thức nào, nên mình không biết trang giấy có đủ để chạy lại hay không.
  Evidence: docs/open-issues.md:330; pkg/council/caller.go:61; pkg/council/store.go:44
  Check: Read code
- **Khách** withdraws it · on P13 · Guide chỉ mình tới một mục sidebar có vẻ đã dời sang Library
  Trùng với đề xuất guide chỉ tới mục Councils, bản đó nêu đủ ba chỗ cần sửa hơn; mình chuyển câu giải thích Library sang đó.
- **Phản biện** has doubts · on P8 · Agreed chép vào AGENTS.md như thể đã xong, và một dòng ghim cứng mã commit
  Bệnh thì mình đồng ý, thuốc thì mình khác. Nhãn to do hay done phải có người lật sang done, mà không ai lật thì nó lỗi thời y như mã commit. ==Mình muốn khối chỉ giữ luật và điều đã loại, còn việc phải làm thì thành chunk có hạn, chỗ đã có người nhắc đúng ngày.==
  Evidence: AGENTS.md:288; AGENTS.md:298; pkg/council/projectdoc.go:31
  Check: Read code
- **Phản biện** has doubts · on P11 · Memory trong AGENTS.md đọc như việc đã xong, trong khi code chưa đổi
  Bạn bắt đúng hai chỗ: câu «Chưa chứng minh» rơi mất khi chép, và một lời phàn nàn bị gắn Agreed. Nhưng nhãn «Đã làm ở commit nào» sẽ lỗi thời ngay lần sửa sau. ==Mình giữ nhãn Phát hiện nhưng cho nó ở lại báo cáo, bỏ nhãn Đã làm, và chuyển việc chưa làm sang chunk có hạn.==
  Evidence: AGENTS.md:296; docs/council/2026-11-19-chat-s-suggested-replies-chatsuggest-the-fix-for-slow-and-me.md:14; pkg/wshrpc/wshserver/wshserver_chatsuggest.go:61
  Check: Read code
- **Phản biện** has doubts · on P14 · Một ghế có bốn tên, và vài chữ nội bộ chưa ai giải thích
  Khung từ vựng 8 dòng chỉ dán băng lên chỗ đặt tên trùng. Bạn đổi tên để không còn hai thứ cùng gọi là «Điều phối», và trong báo cáo thay mã đề xuất ở dòng From bằng tên của nó, thì phần lớn khung từ vựng hết cần.
  Evidence: docs/guide/council.md:4; docs/guide/council.md:72; docs/council/2026-11-19-chat-s-suggested-replies-chatsuggest-the-fix-for-slow-and-me.md:22
  Check: Read code
- **Phản biện** has doubts · on P16 · Tab Memory có trong app mà guide không nhắc, và guide còn đếm sai thứ tự tab
  Thêm mục Memory vào guide thì đúng. Nhưng đừng chép nguyên câu Agreed là «đã chốt, các ghế không cãi lại», vì hai đề xuất về khối AGENTS.md cho thấy chính câu đó làm agent tin việc chưa làm là đã xong. ==Sửa nghĩa của Agreed trước, rồi mới viết guide theo nó.==
  Evidence: frontend/app/view/agents/councilmemorymodel.ts:73; AGENTS.md:288; skills/council/SKILL.md:197
  Check: Read code
- **Phản biện** has doubts · on P19 · Đừng parse mọi council mỗi 10 giây chỉ để tìm cái đang chờ
  Đo trước là đúng, mình đợi số của bạn. Nhưng nếu chậm thật thì đừng làm chỉ mục theo mtime. ==Store vốn là chỗ ghi mọi thay đổi của council, nên nó có thể giữ luôn danh sách council đang chờ trong RAM ngay lúc ghi, và attention chỉ cần đọc danh sách đó.== Một nguồn đúng nằm ngay ở chỗ ghi thì ít chỗ để sai hơn một chỉ mục đoán theo mtime.
  Evidence: pkg/council/store.go:387; pkg/jarvis/attention.go:996; frontend/app/view/agents/attentionpoller.tsx:28
  Check: Read code
- **Phản biện** revises it · on P3 · Khối Council decisions trong AGENTS.md chép nguyên văn cả lịch sử, điều kiện treo lẫn lời phàn nàn, đáng ra phải lọc (replying to Tìm bug)
  New title: Khối Council decisions trong AGENTS.md chép nguyên văn cả lịch sử, điều kiện treo lẫn lời phàn nàn, đáng ra phải lọc. Đọc hai đề xuất về chuyện memory đọc như việc đã xong, mình thêm hàng Phát hiện và lời phàn nàn, và nói rõ vì sao lọc tốt hơn gắn nhãn.
- **UX** has doubts · on P21 · Mỗi tool call ghi cả file council rồi báo hai lần
  Mình ủng hộ gộp save, vì dòng activity đổi nhanh hơn 2 giây thì mắt cũng không đọc kịp. ==Điều kiện là lần ghi cuối của đợt luôn được flush, ghế xong hay vòng đổi vẫn ghi ngay, và đồng hồ chạy ở trang từ mốc bắt đầu.== Mình chưa kiểm được đồng hồ hiện có chạy ở trang không. Còn watch thì chỉ nên bỏ đúng cú ghi của runner, đừng tắt cả watch lúc council chạy.
  Evidence: pkg/council/runner.go:1016; pkg/council/watch.go:105; frontend/app/view/agents/councilstore.ts:111
  Check: Read code
- **Đo RAM** has doubts · on P1 · Giá in trên docs thấp hơn giá thật 3 đến 10 lần, mà skill lại bảo agent tự mở không cần hỏi
  Câu bảo agent cứ mở không cần hỏi nên bỏ ngay, mình không cãi chỗ đó. Câu đó còn đi ngược quy tắc của chính project là nói giá trước khi mở nhiều agent. Chỗ mình thấy lệch là lấy trung vị. Mới có ba điểm đo, và 8,7M là của thiết kế đầu, nên một council lạ kéo cả trung vị đi. Hai council gần nhất lại rất đều, mỗi lượt gọi khoảng 245 nghìn token, tính từ 3,9M chia 16 và 4,7M chia 19. ==Mình nghĩ ước tính nên là số lượt gọi nhân chi phí mỗi lượt gọi, lấy từ các council xong gần nhất, vì nhóm thêm ghế hay thêm file thì trung vị cũ không theo kịp.== Test TestEstimateMatchesTheCanvas chạy qua đúng như bạn đoán. Nhưng nó chỉ khóa số vào bản mockup, nên nó không thể đỏ khi council thật đắt gấp năm.
  Evidence: skills/council/SKILL.md:20; pkg/council/estimate.go:14; pkg/council/estimate_test.go:22; docs/council/2026-11-19-chat-s-suggested-replies-chatsuggest-the-fix-for-slow-and-me.md:372; docs/council/2026-11-17-sidecar-the-second-window-that-shows-the-agents-on-another-s.md:521; docs/council/2026-10-23-arcterm-s-council-feature-v1-as-shipped-the-v2-agent-team-di.md:365
  Check: Read code
- **Đo RAM** has doubts · on P4 · Bàn luôn là cùng bốn ghế, và hai báo cáo gần nhất tự nói thiếu đúng người
  Mình nhận một nửa. Với council hỏi về prompt gợi ý trả lời thì ghế của mình đúng là mỏng. Nhưng mình không theo chuyện bỏ cả nhóm mặc định. Người chọn ghế cũng là một lượt gọi cùng model, nên nó mắc đúng lỗi phiếu không độc lập mà bạn đang chê. Nó còn thêm một lượt gọi, và thêm nữa khi phải viết vai mới, vào một council mà giá đã bị ước tính thấp. ==Mình đề nghị giữ một sàn nhỏ gồm hai ghế hợp với mọi câu hỏi, và để người chọn thêm hai ghế theo câu hỏi.== Phần ba của bạn thì mình ủng hộ hẳn. Câu thiếu một người thành gợi ý ghế cho council sau, mà không tốn thêm lượt gọi nào.
  Evidence: skills/council/SKILL.md:77; docs/council/2026-11-19-chat-s-suggested-replies-chatsuggest-the-fix-for-slow-and-me.md:369; docs/council/2026-11-17-sidecar-the-second-window-that-shows-the-agents-on-another-s.md:519; pkg/council/estimate.go:14
  Check: Read code
- **Đo RAM** has doubts · on P6 · Ước tính chi phí thấp hơn số thật nhiều lần
  Mình ủng hộ in ước tính cạnh số thật. Nhưng chỉ in hai con số thì chưa nói được sai ở đâu. Mình chia lại số của bạn theo từng lượt gọi, bảng này cho thấy điều đó.

  | Nguồn | Lượt gọi | Token | Mỗi lượt gọi |
  |---|---|---|---|
  | Ước tính, nhóm 4 chuyên gia | 10 | 0,84M | khoảng 84 nghìn |
  | Council 19/11 | 16 | 3,9M | khoảng 244 nghìn |
  | Council 17/11 | 19 | 4,7M | khoảng 247 nghìn |
  | Council 23/10 | 9 | 8,7M | khoảng 967 nghìn |

  Hai council gần nhất dùng gần đúng 245 nghìn mỗi lượt. Khoảng cách 4,6 đến 5,6 lần là hai chỗ nhân nhau. Số lượt gọi thật nhiều hơn công thức 1,6 đến 1,9 lần, và mỗi lượt đắt hơn 2,9 lần. ==Sửa riêng một chỗ thì ước tính vẫn thấp hơn thật ít nhất 1,6 lần.== Về đơn vị, vòng này mình không đọc được code nên chưa khẳng định. Ghi chú của project nói đồng hồ 5 giờ phần lớn là cache read. 245 nghìn mỗi lượt hợp với một seat đọc lại cả context ở mỗi tool call, nên mình nghiêng về Run facts có tính cache. Mình sẽ đo bằng cách ghi đồng hồ 5 giờ trước và sau một council thật, rồi so với Run facts.
  Evidence: pkg/council/estimate.go:14; pkg/council/estimate.go:92; pkg/wshrpc/wshserver/wshserver_council.go:394; docs/council/2026-11-19-chat-s-suggested-replies-chatsuggest-the-fix-for-slow-and-me.md:372; docs/council/2026-11-17-sidecar-the-second-window-that-shows-the-agents-on-another-s.md:521; docs/council/2026-10-23-arcterm-s-council-feature-v1-as-shipped-the-v2-agent-team-di.md:365; weak: The lean that Run facts includes cache reads is inferred from ~245k per call; no code was read, so whether the estimate and Run facts share a unit is unverified.
  Check: Read code
- **Đo RAM** has doubts · on P10 · Giá guide hứa thấp hơn giá thật vài lần, và skill vẫn bảo cứ mở không cần hỏi
  Mình đồng ý ba bước, trừ việc chép ba con số vào guide. Ba số đó cũ ngay council sau, và 8,7M là của thiết kế đầu nên không đại diện. ==Mình sẽ ghi một khoảng kèm chi phí mỗi lượt gọi, rồi để thẻ Token burn đọc số đo thật thay cho con số cố định.== Còn câu bạn hỏi, hai bên có đếm cùng thứ không, mình chưa khẳng định được vì chưa đọc code ở vòng này. Cách chốt là ghi đồng hồ 5 giờ trước và sau một council thật rồi so với Run facts.
  Evidence: docs/guide/council.md:32; skills/council/SKILL.md:20; pkg/council/estimate.go:14; docs/council/2026-10-23-arcterm-s-council-feature-v1-as-shipped-the-v2-agent-team-di.md:11
  Check: Read code
- **Đo RAM** has doubts · on P5 · Wild: đối chứng mù, một lượt opus làm một mình chạy cạnh council thật
  Mình sợ nó nhân đôi giá. Council thật đã tốn khoảng 4 đến 9 triệu token, và ước tính còn đang thấp hơn thật. Thêm một opus chạy một mình cạnh nó là thêm một lượt chạy dài, mà mình chưa thấy ai ước giá cho nó. ==Mình đề nghị làm đúng một lần như thí nghiệm, nói giá trước, rồi mới quyết có thành tính năng hay không.==
  Evidence: docs/council/2026-11-19-chat-s-suggested-replies-chatsuggest-the-fix-for-slow-and-me.md:372; docs/council/2026-10-23-arcterm-s-council-feature-v1-as-shipped-the-v2-agent-team-di.md:365
  Check: Read code
- **Tìm bug** has doubts · on P12 · Cite check gọi tên file viết trần là Wrong, người mới đọc thành báo cáo bịa
  Tách nhóm riêng thì mình ủng hộ. Nhưng ==file not found nghĩa là dòng chưa từng được đọc, nên chưa ai biết trong chín chỗ có dòng sai thật hay không.== Còn tự khớp tên trần thì nên tra trong các đường dẫn đầy đủ mà chính báo cáo đã trích, đừng quét đĩa, vì ổ có bản sao worktree cùng tên file.
  Evidence: pkg/council/cites.go:193; pkg/council/cites.go:173; docs/council/2026-11-19-chat-s-suggested-replies-chatsuggest-the-fix-for-slow-and-me.md:82
  Check: Read code
- **Tìm bug** has doubts · on P17 · Báo cáo đã lưu nói bằng mã, còn app nói bằng lời
  Bỏ id khỏi câu thì mất khóa duy nhất. Một ghế nêu nhiều ý, ở council này Tìm bug nêu bốn, nên «From Tìm bug» không chỉ ra ý nào. ==Chữ Agreed còn nằm trong khối AGENTS.md do code dựng từ kho, không đọc từ file md, nên đổi chữ ở file md mà không đổi khối đó thì hai nơi lệch từ.== Mình không đọc được code ở vòng này nên chưa quét hết chỗ parse chữ trong file md.
  Evidence: pkg/council/markdown.go:286; AGENTS.md:288; pkg/council/projectdoc.go:165; pkg/council/types.go:384
  Check: Read code
- **Tìm bug** has doubts · on P18 · Tiêu đề council là cả một câu, nên tên file bị cắt giữa chữ
  Cắt ở ranh giới chữ thì được. Nhưng bạn chưa nói council cũ giữ DocPath đã lưu hay tính lại từ tiêu đề. ==Nếu tính lại thì đổi slug làm dòng Report trong AGENTS.md trỏ vào file không còn.== Và nếu luật slug chỉ giữ a-z với số, chữ Việt có dấu cũng thành gạch như dấu nháy, nên bỏ nháy chưa đủ.
  Evidence: pkg/council/docpath.go:24; pkg/council/docpath.go:42; AGENTS.md:286
  Check: Read code
- **Tìm bug** has doubts · on P20 · Khung luôn mounted đang giữ mọi council nguyên vẹn trong heap trang
  Chưa có số nào cho thấy chuyện này nặng. ==Cái tốn nhiều khả năng là mỗi lần tải lại cả list, mà phép đo heap sau GC bạn đề nghị sẽ không thấy.== Một list gọn cũng tạo hai nguồn cho cùng một council, nên trạng thái ở khung và ở màn đang mở có thể lệch nhau.
  Evidence: frontend/app/view/agents/councilnotifysync.tsx:43; frontend/app/view/agents/councilstore.ts:176; pkg/wshrpc/wshserver/wshserver_council.go:184; pkg/council/types.go:217
  Check: Read code
- **Tìm bug** revises it · on P7 · Cite check kêu sai ở chỗ không sai, và báo đúng ở chỗ rỗng (replying to UX)
  Bỏ cách tự khớp tên trần bằng quét đĩa vì gặp bản sao worktree; thay bằng khớp trong đường dẫn đầy đủ báo cáo đã trích, và thêm nhóm «chưa kiểm».

## Run facts

- Mode: Review · a feature in daily use, to judge
- Experts: UX (sonnet), Đo RAM (sonnet), Khách (sonnet), Tìm bug (sonnet), Phản biện (opus), Thư ký (opus, coordinator)
- Picks: 5 experts on 2 models (sonnet, opus); picks from one model are not independent votes
- Harness: 2026-11-12.1
- Tokens: 9M in 15 calls
- Time: 10 min 44 s
- Ended: done
