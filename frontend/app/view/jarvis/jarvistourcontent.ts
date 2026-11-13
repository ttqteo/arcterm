// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0
//
// The Jarvis tour's words, in Vietnamese and English. The selectors are the surface's own data attributes; a step
// whose target is missing shows its card in the middle, so every body must read right without the spotlight. A
// modifier chord is written `{Alt:ArrowUp}`, never "Alt+↑": the view fills it per platform (keysym.fillKeys).

import type { TourLang, TourTrack } from "./jarvistour";

export const TOUR_UI: Record<
    TourLang,
    Record<
        | "menu"
        | "button"
        | "back"
        | "next"
        | "done"
        | "skip"
        | "offerTitle"
        | "offerBody"
        | "offerStart"
        | "offerLater",
        string
    >
> = {
    vi: {
        menu: "Hướng dẫn",
        button: "Hướng dẫn Jarvis",
        back: "Trước",
        next: "Tiếp",
        done: "Xong",
        skip: "Bỏ qua",
        offerTitle: "Mới dùng Jarvis?",
        offerBody: "Một tour ngắn chỉ từng phần của Brief. Mở lại bất cứ lúc nào bằng nút ?.",
        offerStart: "Xem tour",
        offerLater: "Để sau",
    },
    en: {
        menu: "Tours",
        button: "Jarvis tours",
        back: "Back",
        next: "Next",
        done: "Done",
        skip: "Skip",
        offerTitle: "New to Jarvis?",
        offerBody: "A short tour points at each part of the Brief. Reopen it any time from the ? button.",
        offerStart: "Take the tour",
        offerLater: "Not now",
    },
};

export const TOUR_TRACKS: TourTrack[] = [
    {
        id: "brief",
        vi: { title: "Brief" },
        en: { title: "Brief" },
        steps: [
            {
                id: "brief:waiting",
                target: ["[data-jarvis-waiting-strip]", '[data-jarvis-brief-band="waiting"]'],
                vi: {
                    title: "Việc đang chờ bạn",
                    body: "Câu hỏi của lead và worker, cổng duyệt, task bị chặn và run cần accept gom vào dải này ở đầu trang. Dải chỉ hiện việc gấp nhất, kèm nút hành động của nó; «Show all» mở toàn bộ ngay bên dưới. Khi không có gì chờ, dải biến mất và chỉ còn chip «all clear» trên header. Huy hiệu Jarvis trên nav rail đếm cùng các mục này.",
                },
                en: {
                    title: "What waits on you",
                    body: "Questions from leads and workers, review gates, blocked tasks and runs to accept gather in this strip at the top. It shows the most urgent one with its own action; «Show all» opens the rest right under it. With nothing waiting the strip is gone, and only the «all clear» chip in the header shows. The Jarvis badge on the nav rail counts the same items.",
                },
            },
            {
                id: "brief:regions",
                target: ["[data-jarvis-region-only]"],
                vi: {
                    title: "Bố cục của Brief",
                    body: "Cột chính: dải Waiting on you, rồi Initiatives (các thẻ đã ghim, dưới là danh sách còn lại), dưới cùng là Ideas và For later cạnh nhau. Cột bên cạnh: Activity, Since you looked, Shipped. Nút nhỏ ở cuối tiêu đề Initiatives và Activity (Show only) chỉ hiện vùng đó; bấm lại để hiện tất cả.",
                },
                en: {
                    title: "How the Brief is laid out",
                    body: "The main column holds the Waiting on you strip, then Initiatives: the pinned cards, and every other initiative in a list under them, with Ideas and For later side by side at the bottom. The column beside it holds Activity, Since you looked and Shipped. The small Show only button at the end of the Initiatives and Activity headings shows that region alone; press it again to show them all.",
                },
            },
            {
                id: "brief:activity",
                target: ["[data-jarvis-activity]"],
                vi: {
                    title: "Activity",
                    body: "Run và council đang chạy là các thẻ nhỏ ở đầu cột bên cạnh; bên dưới, «Earlier · 7 days» liệt kê council đã xong và run kết thúc mà không ship. Các tab chọn loại: all, orchestrator, quick, councils; tab cũng lọc Shipped. Bấm một run để mở run sheet, bấm một council để đọc báo cáo của nó trong sheet.",
                },
                en: {
                    title: "Activity",
                    body: "Runs and councils at work are small cards at the top of the side column; under them, «Earlier · 7 days» lists finished councils and runs that ended without shipping. The tabs pick a kind (all, orchestrator, quick, councils) and narrow Shipped too. Click a run to open its run sheet, a council to read its report in the sheet.",
                },
            },
            {
                id: "brief:behind",
                target: ['[data-jarvis-brief-region="behind"]'],
                also: ["[data-jarvis-brief-mark-seen]", '[data-jarvis-brief-region="shipped"]'],
                vi: {
                    title: "Từ lần bạn nhìn",
                    body: "Những gì đổi kể từ lần cuối bạn xem, dưới Activity, chia theo loại: Runs, Initiatives (mỗi initiative một hàng) và Records (gộp thành một hàng, bấm để mở). Ngay dưới là Shipped: những gì đã ship trong 7 ngày qua. «Mark seen» đánh dấu đã xem để Since you looked gọn lại.",
                },
                en: {
                    title: "Since you looked",
                    body: "What changed since you last looked, under Activity, by kind: Runs, Initiatives (one row each) and Records (folded into one row that opens). Shipped sits under it with what shipped in the last seven days. Mark seen clears Since you looked so it stays short.",
                },
            },
            {
                id: "brief:filter",
                target: ["[data-jarvis-brief-filter]"],
                vi: { title: "Lọc Brief", body: "Nhấn / để lọc các hàng của Brief theo tên; Esc xóa lọc." },
                en: {
                    title: "Filter the Brief",
                    body: "Press / to filter the Brief's rows by name; Esc clears the filter.",
                },
            },
            {
                id: "brief:keys",
                vi: {
                    title: "Phím tắt của Brief",
                    body: "j / k: đi qua dải chờ, các thẻ, danh sách, Activity rồi cột bên cạnh · Enter: mở · w: Work on · p: ghim hoặc bỏ ghim initiative · r: run mới · e: mở hoặc gập dải record. {Shift:?} mở danh sách phím đầy đủ.",
                },
                en: {
                    title: "The Brief's keys",
                    body: "j / k: walk the strip, the cards, the list, Activity and the side column · Enter: open · w: Work on · p: pin or unpin an initiative · r: new run · e: open or fold the record band. {Shift:?} lists every key.",
                },
            },
        ],
    },
    {
        id: "initiatives",
        vi: { title: "Initiatives" },
        en: { title: "Initiatives" },
        steps: [
            {
                id: "initiatives:new",
                target: ["[data-jarvis-new-initiative]"],
                vi: {
                    title: "Initiative mới",
                    body: "Việc lớn hơn một run sống thành initiative: một danh sách chunk, mỗi chunk có trạng thái và ghi chú. Bấm đây (hoặc {Shift:n}) để tạo. Agent cũng tạo và cập nhật chúng bằng wsh effort.",
                },
                en: {
                    title: "New initiative",
                    body: "Work bigger than one run lives as an initiative: a list of chunks, each with a state and notes. Click here (or {Shift:n}) to make one. Agents make and update them with wsh effort too.",
                },
            },
            {
                id: "initiatives:cards",
                target: ["[data-jarvis-cards]"],
                also: ["[data-jarvis-segment-bar]"],
                vi: {
                    title: "Thẻ đã ghim",
                    body: "Ghim tối đa sáu initiative để chúng thành thẻ ở đầu trang; chưa ghim cái nào thì sáu cái nên làm trước hiện ở đây. Mỗi thẻ có số chunk đã xong, thanh màu một đoạn cho mỗi chunk, và chunk làm tiếp theo (hoặc chunk đang bị chặn). «Pinned N of M» đếm số đã ghim.",
                },
                en: {
                    title: "Pinned cards",
                    body: "Pin up to six initiatives and they become cards at the top; with none pinned, the six that need you first show here. A card has how many chunks are done, a bar with one segment per chunk, and the chunk to do next (or the one that is blocked). «Pinned N of M» counts the pins.",
                },
            },
            {
                id: "initiatives:list",
                target: ["[data-jarvis-initiative-list]"],
                vi: {
                    title: "Mọi initiative khác",
                    body: "Những initiative không phải thẻ nằm trong danh sách gọn này, mỗi cái một dòng, theo thứ tự nên làm trước. Các tab project lọc danh sách (thẻ luôn hiện). Rê chuột lên một dòng để thấy nút ghim, hoặc nhấn p.",
                },
                en: {
                    title: "Every other initiative",
                    body: "The initiatives that are not cards sit in this compact list, one line each, in the order to look at them. The project tabs narrow the list (the cards always show). Hover a row for its pin, or press p.",
                },
            },
            {
                id: "initiatives:actions",
                target: ["[data-jarvis-card] [data-jarvis-work-on]", "[data-jarvis-work-on]"],
                also: ["[data-jarvis-initiative-menu]"],
                vi: {
                    title: "Work on và menu",
                    body: "Work on (phím w) mở một agent mới làm initiative, hoặc nhảy tới agent đang làm nó. Menu … bên cạnh có Pin, Rename, Edit details, Pause, Archive, Link và Delete.",
                },
                en: {
                    title: "Work on, and the menu",
                    body: "Work on (key w) opens a new agent on the initiative, or jumps to the one already on it. The … menu beside it has Pin, Rename, Edit details, Pause, Archive, Link and Delete.",
                },
            },
            {
                id: "initiatives:sheet",
                target: ["[data-jarvis-initiative-sheet-head]"],
                prepare: "firstInitiative",
                vi: {
                    title: "Initiative trong sheet",
                    body: "Bấm một thẻ hoặc một dòng (hoặc Enter) để mở initiative trong sheet bên phải. Đầu sheet có tiến độ, Pin, Work on và Activity ↗; nút ↑ ↓ đi tới initiative trước hay sau theo thứ tự trên trang. Esc đóng sheet.",
                },
                en: {
                    title: "An initiative in the sheet",
                    body: "Click a card or a row (or press Enter) to open the initiative in the sheet on the right. Its head has the progress, Pin, Work on and Activity ↗; the ↑ ↓ buttons step to the previous or next initiative in the page's order. Esc closes the sheet.",
                },
            },
            {
                id: "initiatives:plan",
                target: ['[data-jarvis-initiative-sheet-body="plan"]'],
                // the step before opened the sheet; keeping it open keeps the plan on screen
                prepare: "firstInitiative",
                vi: {
                    title: "Kế hoạch của initiative",
                    body: "Thân sheet là các stage và chunk, sửa được ngay tại đây: bấm chữ trạng thái để đổi, Add chunk để thêm, {Alt:ArrowUp} / {Alt:ArrowDown} để đổi thứ tự trong stage. j / k di chuyển giữa các chunk; Enter mở chunk ngay trong sheet, với ghi chú và trạng thái của nó.",
                },
                en: {
                    title: "The initiative's plan",
                    body: "The sheet's body is its stages and chunks, edited right there: click a status word to change it, Add chunk to add one, {Alt:ArrowUp} / {Alt:ArrowDown} to reorder within a stage. j / k move between chunks; Enter opens a chunk inside the sheet, with its notes and status.",
                },
            },
            {
                id: "initiatives:ideas",
                target: ["[data-jarvis-ideas]"],
                also: ["[data-jarvis-jot-idea]"],
                vi: {
                    title: "Ideas",
                    body: "Ý tưởng chưa có chunk nằm ở cột bên cạnh. Gõ vào ô «Jot down an idea» rồi Enter để ghi nhanh một ý (Esc xóa ô); mở ý tưởng ra, Plan it nhờ một agent chia nó thành chunk.",
                },
                en: {
                    title: "Ideas",
                    body: "Ideas with no chunks yet live in the column beside the work. Type into «Jot down an idea» and press Enter to note one (Esc clears the box); open an idea and Plan it has an agent split it into chunks.",
                },
            },
            {
                id: "initiatives:archived",
                target: ["[data-jarvis-brief-archived]"],
                vi: {
                    title: "Initiative đã lưu trữ",
                    body: "Initiative đã Archive được giấu đi; bấm đây (cuối danh sách) để hiện lại chúng.",
                },
                en: {
                    title: "Archived initiatives",
                    body: "Archived initiatives are hidden; click here, at the end of the list, to show them again.",
                },
            },
        ],
    },
    {
        id: "runsheet",
        vi: { title: "Run sheet" },
        en: { title: "Run sheet" },
        steps: [
            {
                id: "runsheet:status",
                target: ["[data-run-sheet-verb]"],
                also: ['[data-run-sheet] [role="img"]'],
                prepare: "newestRun",
                vi: {
                    title: "Run đang ở đâu",
                    body: "Động từ cho biết trạng thái: Planning, Working, Final check, Wrapping up, Landing, Waiting on you, Done… Thanh bên dưới có một đoạn cho mỗi task và ba chấm cuối cho Final check, Wrap-up và Land: mọi task xanh mà ba chấm chưa xong thì run chưa xong. Kèm các chip thời gian và số task đã land. Chưa có run nào thì các bước này chỉ là lời giải thích.",
                },
                en: {
                    title: "Where the run stands",
                    body: "The verb says where it is: Planning, Working, Final check, Wrapping up, Landing, Waiting on you, Done… The bar below has one segment per task and three pips at the end for Final check, Wrap-up and Land: all tasks green is not finished until the pips are. Chips show time and tasks landed. With no run yet, these steps only explain.",
                },
            },
            {
                id: "runsheet:tasks",
                target: ["[data-run-sheet-rows]", "[data-run-sheet-empty]"],
                prepare: "newestRun",
                vi: {
                    title: "Tasks",
                    body: "Mỗi task một hàng với trạng thái và một hành động: Open in Agent cho worker đang sống, View child run cho task đã xong, Open DAG cho task kẹt ở merge. Dòng next: bên dưới nói run đang đợi gì. Khi lead hay worker đang hỏi, câu hỏi nằm ngay trên các task.",
                },
                en: {
                    title: "Tasks",
                    body: "One row per task with its state and an action: Open in Agent for a live worker, View child run for a finished task, Open DAG for one stuck at a merge. The next: line below says what the run waits on. When the lead or a worker is asking, its question sits right above the tasks.",
                },
            },
            {
                id: "runsheet:timeline",
                target: ["[data-run-sheet-timeline-toggle]"],
                also: ["[data-run-sheet-timeline]"],
                prepare: "newestRun",
                vi: {
                    title: "Timeline",
                    body: "Mọi sự kiện của run, mới nhất trước. Khi run cần bạn mà chưa rõ vì sao, mở timeline ra đọc trước tiên.",
                },
                en: {
                    title: "Timeline",
                    body: "Every event of the run, newest first. When a run needs you and you cannot tell why, read this first.",
                },
            },
            {
                id: "runsheet:final",
                target: ["[data-run-sheet-final-shots]"],
                prepare: "newestRun",
                vi: {
                    title: "Final check",
                    body: "Khi plan có lệnh Final chụp ảnh, đây là ảnh của vòng final gần nhất. Bấm để mở hộp xem: ↑ / ↓ đổi scenario, ← / → đổi ảnh, Esc đóng.",
                },
                en: {
                    title: "Final check",
                    body: "When the plan has a Final that takes screenshots, these are its last round's. Click to open the viewer: ↑ / ↓ change scenario, ← / → change shot, Esc closes.",
                },
            },
            {
                id: "runsheet:config",
                target: ['[data-jarvis-brief-sheet-config="editable"]'],
                prepare: "newestRun",
                vi: {
                    title: "Cấu hình run",
                    body: "engine · lead · parallelism · workers: run này được dựng thế nào. Adjust đổi độ rộng và route cho các lần dispatch sau, không ảnh hưởng task đang chạy.",
                },
                en: {
                    title: "The run's shape",
                    body: "engine · lead · parallelism · workers: how this run is built. Adjust changes the width and routes for later dispatches, not the tasks already running.",
                },
            },
            {
                id: "runsheet:dock",
                target: ['footer[data-jarvis-brief-sheet-face="settings"]'],
                prepare: "newestRun",
                vi: {
                    title: "Dock",
                    body: "Hành động của run: Open DAG xem đồ thị task, Open lead nhảy tới terminal của lead, Land again khi run bị giữ, và Cancel run.",
                },
                en: {
                    title: "The dock",
                    body: "The run's actions: Open DAG shows the task graph, Open lead jumps to the lead's terminal, Land again retries a held land, and Cancel run.",
                },
            },
            {
                id: "runsheet:nav",
                target: ['[aria-label="Previous run"]'],
                also: ['[aria-label="Next run"]', '[data-jarvis-brief-band="composer"]'],
                prepare: "newestRun",
                vi: {
                    title: "Run kế / trước",
                    body: "j / k (hoặc hai mũi tên này) chuyển sang run kế hoặc trước mà không đóng sheet. Khi run đang sống, ô composer ở đáy (phím i) nhắn thẳng cho lead hay worker.",
                },
                en: {
                    title: "Next and previous run",
                    body: "j / k (or these arrows) move to the next or previous run without closing the sheet. While a run is live, the composer at the bottom (key i) messages its lead or worker directly.",
                },
            },
        ],
    },
    {
        id: "profile",
        vi: { title: "Profile" },
        en: { title: "Profile" },
        steps: [
            {
                id: "profile:button",
                target: ["[data-jarvis-brief-profile]"],
                also: ['[data-jarvis-autonomy="chip"]'],
                vi: {
                    title: "Profile",
                    body: "Nút này mở Profile: mặc định cho các run mới và nguyên tắc cho lead. Chip Autonomy bên cạnh đặt mức tự quyết của Jarvis.",
                },
                en: {
                    title: "Profile",
                    body: "This opens the Profile: the defaults new runs start from and the principles given to leads. The Autonomy chip beside it sets how much Jarvis decides on its own.",
                },
            },
            {
                id: "profile:scope",
                target: [
                    '[data-jarvis-brief-modal="profile"] [role="group"][aria-label="Scope"]',
                    "[data-jarvis-profile-tab]",
                ],
                prepare: "profile",
                vi: {
                    title: "Global hay Project",
                    body: "Global áp dụng cho mọi project; Project chỉ cho project đang chọn. Trường nào để Same as global thì lấy giá trị toàn cục.",
                },
                en: {
                    title: "Global or Project",
                    body: "Global applies to every project; Project to the one picked. A field left at Same as global takes the global value.",
                },
            },
            {
                id: "profile:shape",
                target: ['[data-jarvis-profile-row="Default shape"]'],
                also: ['[data-jarvis-profile-row="Parallel workers"]'],
                prepare: "profile",
                vi: {
                    title: "Hình dạng run",
                    body: "Default shape chọn Quick (một agent) hay Orchestrator (lead chia plan thành task cho worker) cho hộp New. Parallel workers là số worker chạy cùng lúc; auto để lead chọn.",
                },
                en: {
                    title: "A run's shape",
                    body: "Default shape picks Quick (one agent) or Orchestrator (a lead splits a plan into tasks for workers) for the New dialog. Parallel workers is how many run at once; auto lets the lead choose.",
                },
            },
            {
                id: "profile:routes",
                // Lead route is drawn in Project scope only, so the always-present Worker route leads
                target: ['[data-jarvis-profile-row="Worker route"]'],
                also: ['[data-jarvis-profile-row="Lead route"]', '[data-jarvis-profile-row="Reviewer route"]'],
                prepare: "profile",
                vi: {
                    title: "Route: ai chạy, model nào",
                    body: "Lead route là harness và model của lead (chỉ ở scope Project). Worker route là nơi worker chạy: Same as lead, một route riêng, hoặc Reviewer picks. Reviewer route chạy review từng task, review plan và final verify.",
                },
                en: {
                    title: "Routes: who runs, on which model",
                    body: "Lead route is the lead's harness and model (Project scope only). Worker route is where workers run: Same as lead, a route of its own, or Reviewer picks. Reviewer route runs task reviews, the plan review and final verify.",
                },
            },
            {
                id: "profile:landing",
                target: ['[data-jarvis-profile-row="Runs land on"]'],
                prepare: "profile",
                vi: {
                    title: "Run land vào đâu",
                    body: "Own branch (mặc định): run làm trên nhánh wave/<runId> rồi merge về khi xong. Project checkout: làm thẳng trong thư mục của bạn. Với Own branch, nếu checkout có thay đổi chưa commit ở file mà run cũng sửa, run bị giữ đến khi bạn commit.",
                },
                en: {
                    title: "Where runs land",
                    body: "Own branch (the default): the run works on wave/<runId> and is merged back when done. Project checkout: it works in your folder directly. With Own branch, uncommitted edits in the checkout to a file the run also changes hold the land until you commit them.",
                },
            },
            {
                id: "profile:principles",
                target: [
                    '[data-jarvis-global-principles="editor"]',
                    '[aria-label="Customized principle text"]',
                    '[aria-label="Project principle text"]',
                ],
                prepare: "profile",
                vi: {
                    title: "Principles",
                    body: "Các nguyên tắc ngắn được đưa vào prompt của lead. Ở scope Project bạn sửa riêng câu chữ (Customized), tắt một nguyên tắc cho project, hoặc thêm nguyên tắc chỉ của project.",
                },
                en: {
                    title: "Principles",
                    body: "Short rules put into the lead's prompt. In Project scope you can reword one for the project (Customized), turn one off there, or add rules of its own.",
                },
            },
            {
                id: "profile:save",
                target: ['[data-jarvis-brief-modal="profile"] footer'],
                prepare: "profile",
                vi: {
                    title: "Lưu",
                    body: "Save profile lưu thay đổi; chỉ run khởi chạy sau đó dùng giá trị mới. Cờ của wsh runs start thắng profile.",
                },
                en: {
                    title: "Save",
                    body: "Save profile keeps your changes; only runs started afterwards use them. Flags given to wsh runs start win over the profile.",
                },
            },
        ],
    },
];

export function trackOf(id: TourTrack["id"]): TourTrack {
    return TOUR_TRACKS.find((t) => t.id === id)!;
}
