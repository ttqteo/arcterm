// The window's macOS chrome (floatstore.ts): while the window is folded into Sprout, hide the traffic lights, and when it
// folds over a full-screen app put it on every Space, so Sprout shows there; and send the yellow button and ⌘M to Sprout
// instead of the Dock while window:minimize says so. Tauri can do none of the three, so this talks to AppKit. Commands that are not async run on the main thread, which AppKit requires; the marker check turns a
// mistake there into an error instead of undefined behaviour. Both are no-ops on other platforms. It also takes ⌘W off
// the menu's Close Window, so a reflex ⌘W never quits arcterm; the cockpit closes the focused agent on ⌘⇧W. And it
// keeps the window in Mission Control while it is always on top (in_mission_control).
//
// A folded window grows back on its own focus (floatstore.ts setupAutoSprout). ⌘Tab back to arcterm sometimes left it
// folded while a click on the Dock icon grew it back, so each arrival while folded is logged with what AppKit gave, and
// a folded arcterm that comes to the front with no key window makes its window key itself (takes_key).
//
// Folded over a full-screen app, Sprout sits in that app's Space. Growing back gives the window its own collection
// behavior again, which a full-screen Space does not take, so AppKit moves it to its desktop and the screen stays on the
// full-screen app: the Dock icon "showed nothing". A moment after the fold ends, a window no longer on the active Space
// is brought to the front, which takes the screen to its Space (brings_to_front).

use tauri::WebviewWindow;

// What a folded arcterm finds once it has come to the front: ⌘Tab, the Dock icon, a click on Sprout.
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
#[derive(Clone, Copy, Debug)]
struct Arrival {
    active: bool,
    folded: bool,
    // the app has a key window: the main one, or a sheet or dialog of it
    has_key: bool,
    visible: bool,
    minimized: bool,
}

// Whether the window takes the key itself: arcterm is in front and folded, but no window of it has the key, so no focus
// reaches the page to grow it back and keys typed go nowhere. A minimized or hidden window is left to the Dock.
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
fn takes_key(a: Arrival) -> bool {
    a.active && a.folded && !a.has_key && a.visible && !a.minimized
}

// The window just grown back from the fold, a moment later.
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
#[derive(Clone, Copy, Debug)]
struct Unfolded {
    // folded again since: the fold's own chrome puts it on every Space
    folded: bool,
    on_active_space: bool,
    visible: bool,
    minimized: bool,
}

// Whether the grown-back window is brought to the front: it left the Space on screen (a full-screen app's) when it got
// its own collection behavior back. A minimized or hidden one stays where the person put it.
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
fn brings_to_front(u: Unfolded) -> bool {
    !u.folded && !u.on_active_space && u.visible && !u.minimized
}

#[cfg(target_os = "macos")]
mod imp {
    use std::cell::{Cell, RefCell};
    use std::sync::atomic::{AtomicU32, Ordering};
    use std::sync::OnceLock;

    use block2::RcBlock;
    use dispatch2::{DispatchQueue, DispatchTime};
    use objc2::rc::{Retained, Weak};
    use objc2::runtime::{AnyClass, AnyObject, Bool, NSObject, NSObjectProtocol, Sel};
    use objc2::{define_class, msg_send, sel, MainThreadMarker, MainThreadOnly, Message};
    use objc2_app_kit::{
        NSApplication, NSApplicationDidBecomeActiveNotification, NSAutoresizingMaskOptions, NSBackingStoreType, NSColor,
        NSFontAttributeName, NSForegroundColorAttributeName, NSMenuItem, NSPanel, NSStatusItem, NSView, NSWindow,
        NSWindowButton, NSWindowCollectionBehavior, NSWindowStyleMask,
    };
    use objc2_foundation::{ns_string, NSMutableAttributedString, NSNotificationCenter, NSRange, NSString};
    use tauri::{AppHandle, Emitter, Manager, WebviewWindow};

    use super::{brings_to_front, takes_key, Arrival, Unfolded};
    use crate::applog;

    static APP: OnceLock<AppHandle> = OnceLock::new();

    // AppKit may hand the key back after it posts that the app became active, so the window is looked at a moment later
    const ARRIVAL_CHECK_DELAY_S: f64 = 0.15;
    // AppKit moves a window off a full-screen Space some time after its collection behavior changes
    const UNFOLD_SPACE_CHECK_DELAY_S: f64 = 0.3;

    define_class!(
        // SAFETY: NSObject has no subclassing requirements, and this class does not implement Drop.
        #[unsafe(super(NSObject))]
        #[thread_kind = MainThreadOnly]
        #[name = "ArcMinimizeTarget"]
        struct MinimizeTarget;

        impl MinimizeTarget {
            #[unsafe(method(minimizeToSprout:))]
            fn minimize_to_sprout(&self, _sender: Option<&AnyObject>) {
                if let Some(app) = APP.get() {
                    let _ = app.emit("window-minimize", ());
                }
            }
        }
    );

    impl MinimizeTarget {
        fn new(mtm: MainThreadMarker) -> Retained<Self> {
            unsafe { msg_send![Self::alloc(mtm), init] }
        }
    }

    define_class!(
        // SAFETY: NSObject has no subclassing requirements, and this class does not implement Drop.
        #[unsafe(super(NSObject))]
        #[thread_kind = MainThreadOnly]
        #[name = "ArcArrivalObserver"]
        struct ArrivalObserver;

        impl ArrivalObserver {
            #[unsafe(method(appDidBecomeActive:))]
            fn app_did_become_active(&self, _note: Option<&AnyObject>) {
                // SAFETY: checkArrival: is this class's own method, taking one object it ignores
                unsafe {
                    let _: () = msg_send![
                        self,
                        performSelector: sel!(checkArrival:),
                        withObject: None::<&AnyObject>,
                        afterDelay: ARRIVAL_CHECK_DELAY_S
                    ];
                }
            }

            #[unsafe(method(checkArrival:))]
            fn check_arrival(&self, _: Option<&AnyObject>) {
                check_arrival();
            }

            #[unsafe(method(checkUnfoldSpace:))]
            fn check_unfold_space(&self, _: Option<&AnyObject>) {
                check_unfold_space();
            }
        }
    );

    impl ArrivalObserver {
        fn new(mtm: MainThreadMarker) -> Retained<Self> {
            unsafe { msg_send![Self::alloc(mtm), init] }
        }
    }

    // A button or a menu item holds its target weakly, so the redirect keeps it alive here, with the target and action
    // each gets back when the redirect ends.
    struct Redirect {
        _target: Retained<MinimizeTarget>,
        original_target: Option<Retained<AnyObject>>,
        original_action: Option<Sel>,
        // the app menu's Minimize item (⌘M), when the menu has one
        menu_item: Option<(Retained<NSMenuItem>, Option<Retained<AnyObject>>, Option<Sel>)>,
    }

    thread_local! {
        static REDIRECT: RefCell<Option<Redirect>> = const { RefCell::new(None) };
        // the window's collection behavior from before the fold, given back on the way out
        static UNFOLDED_BEHAVIOR: Cell<Option<NSWindowCollectionBehavior>> = const { Cell::new(None) };
        // set_folded_chrome's last word, for the arrival check
        static FOLDED: Cell<bool> = const { Cell::new(false) };
        // the notification center holds its observer weakly
        static ARRIVAL_OBSERVER: RefCell<Option<Retained<ArrivalObserver>>> = const { RefCell::new(None) };
    }

    fn ns_window<'a>(window: &'a WebviewWindow, _mtm: MainThreadMarker) -> Result<&'a NSWindow, String> {
        let ptr = window.ns_window().map_err(|e| e.to_string())?;
        // SAFETY: Tauri hands back this window's live NSWindow*, which outlives the call, and we are on the main thread
        Ok(unsafe { &*(ptr as *const NSWindow) })
    }

    // ⌘M is the app menu's Minimize item, which sends performMiniaturize: to the window: it is pointed at the same
    // target, so it folds whether or not AppKit routes it through the button.
    fn minimize_menu_item(mtm: MainThreadMarker) -> Option<Retained<NSMenuItem>> {
        let menu = NSApplication::sharedApplication(mtm).mainMenu()?;
        for i in 0..menu.numberOfItems() {
            let Some(sub) = menu.itemAtIndex(i).and_then(|item| item.submenu()) else {
                continue;
            };
            for j in 0..sub.numberOfItems() {
                if let Some(item) = sub.itemAtIndex(j) {
                    if item.action() == Some(sel!(performMiniaturize:)) {
                        return Some(item);
                    }
                }
            }
        }
        None
    }

    // Tauri's default menu has Close Window (performClose:) on ⌘W, in File and in Window. Closing the window quits
    // arcterm and every agent in it when the menu bar icon is off, so the items keep their place in the menu but lose
    // the key.
    pub fn free_close_window_key() {
        let Some(mtm) = MainThreadMarker::new() else {
            return;
        };
        let Some(menu) = NSApplication::sharedApplication(mtm).mainMenu() else {
            return;
        };
        for i in 0..menu.numberOfItems() {
            let Some(sub) = menu.itemAtIndex(i).and_then(|item| item.submenu()) else {
                continue;
            };
            for j in 0..sub.numberOfItems() {
                if let Some(item) = sub.itemAtIndex(j) {
                    if item.action() == Some(sel!(performClose:)) {
                        item.setKeyEquivalent(ns_string!(""));
                    }
                }
            }
        }
    }

    // Pinned in Float or folded, the window is always on top, a level whose default collection behavior is Transient,
    // which Mission Control hides: Managed keeps it there. At the normal level Managed is the default already. AppKit
    // throws on more than one of managed, transient and stationary.
    fn in_mission_control(was: NSWindowCollectionBehavior) -> NSWindowCollectionBehavior {
        let behavior = was & !(NSWindowCollectionBehavior::Transient | NSWindowCollectionBehavior::Stationary);
        behavior | NSWindowCollectionBehavior::Managed
    }

    define_class!(
        // A non-activating panel made from scratch, which hosts the tray popover's webview while it shows: a panel
        // takes key without making arcterm the active app, so opening the popover leaves the cockpit where it is (spec
        // 2026-10-15-tray-popover-design.md). canBecomeKeyWindow lets the webview take keys; losing the key closes
        // the popover, as the blur does on Windows.
        // SAFETY: NSPanel has no subclassing requirements, and this class does not implement Drop.
        #[unsafe(super(NSPanel))]
        #[thread_kind = MainThreadOnly]
        #[name = "ArcTrayPanel"]
        struct ArcTrayPanel;

        impl ArcTrayPanel {
            #[unsafe(method(canBecomeKeyWindow))]
            fn can_become_key_window(&self) -> bool {
                true
            }

            #[unsafe(method(resignKeyWindow))]
            fn resign_key_window(&self) {
                // SAFETY: NSWindow's resignKeyWindow takes nothing and returns nothing
                let _: () = unsafe { msg_send![super(self), resignKeyWindow] };
                if let Some(blurred) = PANEL_BLURRED.get() {
                    blurred();
                }
            }
        }
    );

    static PANEL_BLURRED: OnceLock<fn()> = OnceLock::new();

    // The popover's panel, its webview, the view in tao's window the webview came from and goes back to, and the status
    // item drawn selected while the panel shows (present_from_tray)
    struct Hosted {
        panel: Retained<ArcTrayPanel>,
        web: Retained<NSView>,
        home: Retained<NSView>,
        item: Option<Retained<NSStatusItem>>,
    }

    thread_local! {
        static HOSTED: RefCell<Option<Hosted>> = const { RefCell::new(None) };
    }

    // The WKWebView wry put in tao's window, searched for under its content view
    fn find_webview(view: &NSView) -> Option<Retained<NSView>> {
        let class = AnyClass::get(c"WKWebView")?;
        // SAFETY: isKindOfClass:, subviews, count and objectAtIndex: are NSObject's, NSView's and NSArray's own
        unsafe {
            let is_web: bool = msg_send![view, isKindOfClass: class];
            if is_web {
                return Some(view.retain());
            }
            let subviews: Retained<AnyObject> = msg_send![view, subviews];
            let count: usize = msg_send![&*subviews, count];
            for i in 0..count {
                let sub: Retained<NSView> = msg_send![&*subviews, objectAtIndex: i];
                if let Some(web) = find_webview(&sub) {
                    return Some(web);
                }
            }
        }
        None
    }

    // Runs from the tray's open, on the main thread: the popover's webview moves out of tao's window, which stays
    // hidden, into a fresh ArcTrayPanel, which shows and takes the key without Tauri's show or set_focus, which would
    // activate arcterm. Tao's window keeps its class: swapping it for a panel class once the webview was in lost the
    // observers KVO keeps on it, so the destroy threw NSRangeException and aborted the app (2026-10-16).
    pub fn show_in_panel(window: &WebviewWindow, blurred: fn()) {
        let Some(mtm) = MainThreadMarker::new() else {
            return;
        };
        let Ok(ns) = ns_window(window, mtm) else {
            return;
        };
        let _ = PANEL_BLURRED.set(blurred);
        let Some(home) = ns.contentView() else {
            return;
        };
        let Some(web) = find_webview(&home) else {
            applog::log_line("[tray] no webview in the popover's window: it stays hidden");
            return;
        };
        let style = NSWindowStyleMask::Borderless | NSWindowStyleMask::NonactivatingPanel;
        // SAFETY: NSPanel's designated initializer, on the main thread
        let panel: Retained<ArcTrayPanel> = unsafe {
            msg_send![
                ArcTrayPanel::alloc(mtm),
                initWithContentRect: ns.frame(),
                styleMask: style,
                backing: NSBackingStoreType::Buffered,
                defer: false
            ]
        };
        // SAFETY: the panel is kept in HOSTED until close_panel closes it, so AppKit must not release it on close
        unsafe { panel.setReleasedWhenClosed(false) };
        panel.setHidesOnDeactivate(false);
        panel.setOpaque(false);
        panel.setBackgroundColor(Some(&NSColor::clearColor()));
        panel.setHasShadow(true);
        panel.setLevel(ns.level());
        panel.setCollectionBehavior(
            NSWindowCollectionBehavior::CanJoinAllSpaces
                | NSWindowCollectionBehavior::FullScreenAuxiliary
                | NSWindowCollectionBehavior::Transient,
        );
        let Some(content) = panel.contentView() else {
            return;
        };
        web.setFrame(content.bounds());
        web.setAutoresizingMask(NSAutoresizingMaskOptions::ViewWidthSizable | NSAutoresizingMaskOptions::ViewHeightSizable);
        content.addSubview(&web);
        panel.orderFrontRegardless();
        panel.makeKeyWindow();
        panel.makeFirstResponder(Some(&web));
        HOSTED.with(|h| *h.borrow_mut() = Some(Hosted { panel, web, home, item: None }));
    }

    // Runs from the tray's place, through after_tao_frame, once tao's hidden window has the popover's size and place
    pub fn panel_follow(window: &WebviewWindow) {
        let Some(mtm) = MainThreadMarker::new() else {
            return;
        };
        let Ok(ns) = ns_window(window, mtm) else {
            return;
        };
        HOSTED.with(|h| {
            if let Some(hosted) = &*h.borrow() {
                hosted.panel.setFrame_display(ns.frame(), true);
            }
        });
    }

    // tao 0.35.3 never frees a window it made: it keeps the alloc of the NSWindow on top of its own reference, and one
    // more reference to the window's delegate, whose state holds the window. The tray popover is a new window on every
    // open, so each close left its window, view and delegate behind (2026-10-16). Just before the destroy the popover's
    // window and delegate are watched weakly; a second after it, the delegate is taken off the theme notifications it
    // never leaves and released if tao's one reference is all it has, then the window likewise. A tao that frees them
    // itself leaves nothing to release, and any other count is logged and left alone.
    const LEFT_BEHIND_CHECK_DELAY: std::time::Duration = std::time::Duration::from_secs(1);

    thread_local! {
        static LEFT_BEHIND: RefCell<Vec<(Weak<AnyObject>, Weak<AnyObject>)>> = const { RefCell::new(Vec::new()) };
    }

    pub fn free_when_destroyed(window: &WebviewWindow) {
        let Some(mtm) = MainThreadMarker::new() else {
            return;
        };
        let Ok(ns) = ns_window(window, mtm) else {
            return;
        };
        // SAFETY: NSWindow's delegate getter
        let delegate: Option<Retained<AnyObject>> = unsafe { msg_send![ns, delegate] };
        let Some(delegate) = delegate else {
            return;
        };
        let as_object: &AnyObject = ns;
        LEFT_BEHIND.with(|l| l.borrow_mut().push((Weak::from(as_object), Weak::from_retained(&delegate))));
        let when = DispatchTime::try_from(LEFT_BEHIND_CHECK_DELAY).unwrap_or(DispatchTime::NOW);
        let _ = DispatchQueue::main().after(when, free_left_behind);
    }

    // The object's retain count, counting the reference load just took, is 2 when tao's leaked one is all that is left
    fn only_tao_holds(obj: &AnyObject) -> Result<(), usize> {
        // SAFETY: retainCount is NSObject's, and the object is held for the call
        let count: usize = unsafe { msg_send![obj, retainCount] };
        if count == 2 {
            Ok(())
        } else {
            Err(count)
        }
    }

    // SAFETY (callers): only_tao_holds just passed for obj, and the caller has dropped its own reference to it
    unsafe fn release(obj: *mut AnyObject) {
        let _: () = unsafe { msg_send![obj, release] };
    }

    fn free_left_behind() {
        let left = LEFT_BEHIND.with(|l| std::mem::take(&mut *l.borrow_mut()));
        for (window, delegate) in left {
            if let Some(d) = delegate.load() {
                if let Err(count) = only_tao_holds(&d) {
                    applog::log_line(&format!("[tray] the closed popover's delegate has {count} references: it stays"));
                    continue;
                }
                // SAFETY: NSDistributedNotificationCenter's own methods; the delegate is held for the call
                unsafe {
                    let center: Retained<AnyObject> =
                        msg_send![objc2::class!(NSDistributedNotificationCenter), defaultCenter];
                    let _: () = msg_send![&*center, removeObserver: &*d];
                }
                let ptr = Retained::as_ptr(&d) as *mut AnyObject;
                drop(d);
                // SAFETY: only tao's leaked reference is left, and ours is dropped
                unsafe { release(ptr) };
            }
            if let Some(w) = window.load() {
                if let Err(count) = only_tao_holds(&w) {
                    applog::log_line(&format!("[tray] the closed popover's window has {count} references: it stays"));
                    continue;
                }
                let ptr = Retained::as_ptr(&w) as *mut AnyObject;
                drop(w);
                // SAFETY: only tao's leaked reference is left, and ours is dropped
                unsafe { release(ptr) };
                applog::log_line("[tray] freed the closed popover's window, which tao leaves behind");
            }
        }
    }

    // Runs from the tray's close before the destroy, and at exit, on the main thread: the webview goes back into tao's
    // window, where wry takes it out on destroy, and the panel goes. The panel's resignKeyWindow on the way out finds
    // the popover already closing.
    pub fn close_panel() {
        let Some(hosted) = HOSTED.with(|h| h.borrow_mut().take()) else {
            return;
        };
        if let Some(item) = &hosted.item {
            if item.respondsToSelector(sel!(_didPresentContent:)) {
                // SAFETY: the method's encoding is v@:@, on the main thread, with the panel present_from_tray gave it
                let _: () = unsafe { msg_send![&**item, _didPresentContent: &*hosted.panel] };
            } else if let Some(button) = MainThreadMarker::new().and_then(|mtm| item.button(mtm)) {
                button.highlight(false);
            }
        }
        hosted.web.setFrame(hosted.home.bounds());
        hosted.home.addSubview(&hosted.web);
        hosted.panel.orderOut(None);
        hosted.panel.close();
    }

    // An exception AppKit throws inside a tao callback cannot unwind into Rust, so the process aborts and the crash
    // report keeps only "abort() called" (the tray popover's crash, 2026-10-16). The preprocessor sees each exception
    // as it is thrown, before any unwinding, and writes the first few to the log with the stack that threw them.
    static PREV_PREPROCESSOR: OnceLock<unsafe extern "C" fn(*mut AnyObject) -> *mut AnyObject> = OnceLock::new();
    static EXCEPTIONS_LOGGED: AtomicU32 = AtomicU32::new(0);

    unsafe extern "C" fn log_exception(exception: *mut AnyObject) -> *mut AnyObject {
        if let Some(e) = unsafe { exception.as_ref() } {
            // anything can be thrown; only an NSException answers name and reason
            let is_ns: bool = unsafe { msg_send![e, isKindOfClass: objc2::class!(NSException)] };
            if is_ns && EXCEPTIONS_LOGGED.fetch_add(1, Ordering::Relaxed) < 20 {
                let name: Option<Retained<NSString>> = unsafe { msg_send![e, name] };
                let reason: Option<Retained<NSString>> = unsafe { msg_send![e, reason] };
                let stack: Option<Retained<AnyObject>> = unsafe { msg_send![objc2::class!(NSThread), callStackSymbols] };
                let stack: Option<Retained<NSString>> = match stack {
                    Some(s) => unsafe { msg_send![&*s, description] },
                    None => None,
                };
                let mut lines = vec![format!(
                    "[tauri] objc exception {}: {}",
                    name.map(|n| n.to_string()).unwrap_or_default(),
                    reason.map(|r| r.to_string()).unwrap_or_default()
                )];
                let stack = stack.map(|s| s.to_string()).unwrap_or_default();
                lines.extend(stack.lines().map(|l| format!("[tauri]   {}", l.trim())));
                applog::write_now(&lines);
            }
        }
        match PREV_PREPROCESSOR.get() {
            Some(prev) => unsafe { prev(exception) },
            None => exception,
        }
    }

    pub fn log_objc_exceptions() {
        let prev = unsafe { objc2::ffi::objc_setExceptionPreprocessor(log_exception) };
        let _ = PREV_PREPROCESSOR.set(prev);
    }

    /// Colours the first character of the status item's title (trayicon::MAC_ALERT) red, keeping the button's own
    /// font, so the red dot shows beside the count at critical memory pressure. Call it after set_title(title).
    pub fn tint_tray_alert(tray: &tauri::tray::TrayIcon, title: String) {
        let _ = tray.with_inner_tray_icon(move |inner| {
            let (Some(item), Some(mtm)) = (inner.ns_status_item(), MainThreadMarker::new()) else {
                return;
            };
            let Some(button) = item.button(mtm) else {
                return;
            };
            let text = NSMutableAttributedString::from_nsstring(&NSString::from_str(&title));
            let whole = NSRange::new(0, text.length());
            let dot = NSRange::new(0, "●".encode_utf16().count());
            unsafe {
                if let Some(font) = button.font() {
                    text.addAttribute_value_range(NSFontAttributeName, &font, whole);
                }
                text.addAttribute_value_range(NSForegroundColorAttributeName, &NSColor::systemRedColor(), dot);
            }
            button.setAttributedTitle(&text);
        });
    }

    /// Has the menu bar draw the status item selected while the popover's panel shows, as it does for an NSPopover or a
    /// menu. On macOS 27 the button's own highlight: sets the state and draws nothing (2026-10-17); an NSPopover shown
    /// from the button tells its item with the private _willPresentContent:cancellationHandler: and, once closed,
    /// _didPresentContent: (close_panel), found in a message trace of one. A macOS without them gets highlight:.
    pub fn present_from_tray(tray: &tauri::tray::TrayIcon) {
        let _ = tray.with_inner_tray_icon(|inner| {
            let (Some(item), Some(mtm)) = (inner.ns_status_item(), MainThreadMarker::new()) else {
                return;
            };
            HOSTED.with(|h| {
                let mut h = h.borrow_mut();
                let Some(hosted) = h.as_mut() else {
                    return;
                };
                if item.respondsToSelector(sel!(_willPresentContent:cancellationHandler:)) {
                    // the menu bar calls it to take the selection away, as for another item's menu: the popover goes
                    let cancel = RcBlock::new(|_animated: Bool| {
                        applog::log_line("[tray] the menu bar dismissed the popover");
                        if let Some(blurred) = PANEL_BLURRED.get() {
                            blurred();
                        }
                    });
                    // SAFETY: the method's encoding is v@:@@? (a void (^)(BOOL) block), on the main thread; the item
                    // is told _didPresentContent: with the same panel before close_panel lets the panel go
                    let _: () = unsafe {
                        msg_send![&*item, _willPresentContent: &*hosted.panel, cancellationHandler: &*cancel]
                    };
                } else if let Some(button) = item.button(mtm) {
                    button.highlight(true);
                }
                hosted.item = Some(item);
            });
        });
    }

    // Runs from setup, on the main thread. The fold gives back the behavior it found, so this one holds for good.
    pub fn show_in_mission_control(window: &WebviewWindow) {
        let Some(mtm) = MainThreadMarker::new() else {
            return;
        };
        if let Ok(ns) = ns_window(window, mtm) {
            ns.setCollectionBehavior(in_mission_control(ns.collectionBehavior()));
        }
    }

    // The folded window's collection behavior, from its own. Folded on its desktop it stays there: a window on every
    // Space lands, once it no longer is, on the Space on screen, so a Sprout clicked on another desktop grew arcterm back
    // there and moved it off its own. Folded over a full-screen app (`follows`) it is on every Space and allowed beside a
    // full-screen window, so Sprout shows over it. AppKit throws on a behavior that is both full-screen primary and
    // auxiliary, or both joins all Spaces and moves to the active one, so those come off.
    fn folded_behavior(was: NSWindowCollectionBehavior, follows: bool) -> NSWindowCollectionBehavior {
        let mut behavior = in_mission_control(was);
        if follows {
            behavior &= !(NSWindowCollectionBehavior::MoveToActiveSpace
                | NSWindowCollectionBehavior::FullScreenPrimary
                | NSWindowCollectionBehavior::FullScreenNone);
            behavior |= NSWindowCollectionBehavior::CanJoinAllSpaces | NSWindowCollectionBehavior::FullScreenAuxiliary;
        }
        behavior
    }

    pub fn set_folded_chrome(window: &WebviewWindow, folded: bool) -> Result<(), String> {
        let mtm = MainThreadMarker::new().ok_or("not on the main thread")?;
        let ns = ns_window(window, mtm)?;
        FOLDED.with(|cell| cell.set(folded));
        for kind in [NSWindowButton::CloseButton, NSWindowButton::MiniaturizeButton, NSWindowButton::ZoomButton] {
            if let Some(button) = ns.standardWindowButton(kind) {
                button.setHidden(folded);
            }
        }
        if folded {
            let was = ns.collectionBehavior();
            UNFOLDED_BEHAVIOR.with(|cell| cell.set(Some(cell.get().unwrap_or(was))));
            // off the Space on screen while it folds: a full-screen app's took it (foreground.rs folds for no other)
            ns.setCollectionBehavior(folded_behavior(was, !ns.isOnActiveSpace()));
        } else if let Some(was) = UNFOLDED_BEHAVIOR.with(|cell| cell.take()) {
            ns.setCollectionBehavior(was);
            let _ = APP.set(window.app_handle().clone());
            ARRIVAL_OBSERVER.with(|cell| {
                if let Some(observer) = cell.borrow().as_ref() {
                    // SAFETY: checkUnfoldSpace: is the observer's own method, taking one object it ignores
                    unsafe {
                        let _: () = msg_send![
                            &**observer,
                            performSelector: sel!(checkUnfoldSpace:),
                            withObject: None::<&AnyObject>,
                            afterDelay: UNFOLD_SPACE_CHECK_DELAY_S
                        ];
                    }
                }
            });
        }
        Ok(())
    }

    pub fn watch_arrivals(app: &AppHandle) {
        let Some(mtm) = MainThreadMarker::new() else {
            return;
        };
        let _ = APP.set(app.clone());
        let observer = ArrivalObserver::new(mtm);
        let as_object: &AnyObject = &observer;
        // SAFETY: the observer is kept alive in ARRIVAL_OBSERVER for the app's life, and appDidBecomeActive: is its
        // method taking the notification
        unsafe {
            NSNotificationCenter::defaultCenter().addObserver_selector_name_object(
                as_object,
                sel!(appDidBecomeActive:),
                Some(NSApplicationDidBecomeActiveNotification),
                None,
            );
        }
        ARRIVAL_OBSERVER.with(|cell| *cell.borrow_mut() = Some(observer));
    }

    fn check_arrival() {
        let Some(mtm) = MainThreadMarker::new() else {
            return;
        };
        if !FOLDED.with(|cell| cell.get()) {
            return;
        }
        let Some(window) = APP.get().and_then(|app| app.get_webview_window("main")) else {
            return;
        };
        let Ok(ns) = ns_window(&window, mtm) else {
            return;
        };
        let app = NSApplication::sharedApplication(mtm);
        let arrival = Arrival {
            active: app.isActive(),
            folded: true,
            has_key: app.keyWindow().is_some(),
            visible: ns.isVisible(),
            minimized: ns.isMiniaturized(),
        };
        let mut line = format!(
            "[tauri] [fold] arcterm in front while folded: active {}, key window {}, main window key {}, visible {}, \
             minimized {}, ignores mouse {}",
            arrival.active,
            arrival.has_key,
            ns.isKeyWindow(),
            arrival.visible,
            arrival.minimized,
            ns.ignoresMouseEvents()
        );
        if takes_key(arrival) {
            ns.makeKeyWindow();
            line.push_str(&format!("; made it key: {}", ns.isKeyWindow()));
        }
        applog::log_line(&line);
    }

    fn check_unfold_space() {
        let Some(mtm) = MainThreadMarker::new() else {
            return;
        };
        let Some(window) = APP.get().and_then(|app| app.get_webview_window("main")) else {
            return;
        };
        let Ok(ns) = ns_window(&window, mtm) else {
            return;
        };
        let unfolded = Unfolded {
            folded: FOLDED.with(|cell| cell.get()),
            on_active_space: ns.isOnActiveSpace(),
            visible: ns.isVisible(),
            minimized: ns.isMiniaturized(),
        };
        if !brings_to_front(unfolded) {
            return;
        }
        // activating arcterm takes the screen to a Space holding its window, and the window to the front there
        #[allow(deprecated)]
        NSApplication::sharedApplication(mtm).activateIgnoringOtherApps(true);
        ns.makeKeyAndOrderFront(None);
        applog::log_line(&format!(
            "[tauri] [fold] grown back off the Space on screen (a full-screen app's): brought it to the front, on the \
             active Space now {}",
            ns.isOnActiveSpace()
        ));
    }

    pub fn redirect_minimize(window: &WebviewWindow, on: bool) -> Result<(), String> {
        let mtm = MainThreadMarker::new().ok_or("not on the main thread")?;
        let _ = APP.set(window.app_handle().clone());
        let ns = ns_window(window, mtm)?;
        let Some(button) = ns.standardWindowButton(NSWindowButton::MiniaturizeButton) else {
            return Ok(());
        };
        REDIRECT.with(|cell| {
            let mut slot = cell.borrow_mut();
            if on && slot.is_none() {
                let target = MinimizeTarget::new(mtm);
                let original_target = button.target();
                let original_action = button.action();
                let as_object: &AnyObject = &target;
                // SAFETY: the target is kept alive in REDIRECT for as long as the button and the item point at it
                unsafe {
                    button.setTarget(Some(as_object));
                    button.setAction(Some(sel!(minimizeToSprout:)));
                }
                let menu_item = minimize_menu_item(mtm).map(|item| {
                    let (target_was, action_was) = (item.target(), item.action());
                    // SAFETY: as above
                    unsafe {
                        item.setTarget(Some(as_object));
                        item.setAction(Some(sel!(minimizeToSprout:)));
                    }
                    (item, target_was, action_was)
                });
                *slot = Some(Redirect { _target: target, original_target, original_action, menu_item });
            } else if !on {
                if let Some(r) = slot.take() {
                    // SAFETY: these are the button's and the item's own targets and actions from before the redirect
                    unsafe {
                        button.setTarget(r.original_target.as_deref());
                        button.setAction(r.original_action);
                        if let Some((item, target, action)) = r.menu_item {
                            item.setTarget(target.as_deref());
                            item.setAction(action);
                        }
                    }
                }
            }
        });
        Ok(())
    }

    #[cfg(test)]
    mod tests {
        use super::{folded_behavior, in_mission_control};
        use objc2_app_kit::NSWindowCollectionBehavior as B;

        #[test]
        fn a_window_kept_on_top_still_shows_in_mission_control() {
            let pinned = in_mission_control(B::Transient | B::FullScreenPrimary);
            assert!(pinned.contains(B::Managed | B::FullScreenPrimary));
            assert!(!pinned.intersects(B::Transient | B::Stationary));
        }

        #[test]
        fn the_folded_window_shows_in_mission_control() {
            for follows in [false, true] {
                let folded = folded_behavior(B::Default, follows);
                assert!(folded.contains(B::Managed));
                assert!(!folded.intersects(B::Transient | B::Stationary));
            }
        }

        #[test]
        fn folded_on_its_desktop_the_window_stays_there() {
            let folded = folded_behavior(B::Managed | B::FullScreenPrimary, false);
            assert_eq!(folded, B::Managed | B::FullScreenPrimary);
        }

        #[test]
        fn the_folded_window_drops_what_appkit_will_not_take_beside_its_own() {
            let folded = folded_behavior(B::MoveToActiveSpace | B::FullScreenPrimary | B::Transient, true);
            assert!(folded.contains(B::CanJoinAllSpaces | B::FullScreenAuxiliary | B::Managed));
            assert!(!folded.intersects(B::MoveToActiveSpace | B::FullScreenPrimary | B::Transient));
        }

        #[test]
        fn a_thrown_exception_passes_through_the_log_and_on_to_its_catcher() {
            use objc2::rc::Retained;
            use objc2::runtime::AnyObject;
            use objc2::{class, msg_send};
            use objc2_foundation::ns_string;
            use std::sync::atomic::Ordering;

            super::log_objc_exceptions();
            let before = super::EXCEPTIONS_LOGGED.load(Ordering::Relaxed);
            let caught = objc2::exception::catch(|| unsafe {
                let e: Retained<AnyObject> = msg_send![class!(NSException), exceptionWithName: ns_string!("ArcProbe"),
                    reason: ns_string!("thrown by the test"), userInfo: std::ptr::null::<AnyObject>()];
                let _: () = msg_send![&*e, raise];
            });
            let e = caught.expect_err("raise throws").expect("an NSException");
            let name: Option<Retained<objc2_foundation::NSString>> = unsafe { msg_send![&*e, name] };
            assert_eq!(name.map(|n| n.to_string()).as_deref(), Some("ArcProbe"));
            assert_eq!(super::EXCEPTIONS_LOGGED.load(Ordering::Relaxed), before + 1);
        }
    }
}

// Runs first thing in main, after the panic hook.
pub fn log_objc_exceptions() {
    #[cfg(target_os = "macos")]
    imp::log_objc_exceptions();
}

// Runs from setup, on the main thread, once Tauri has installed the app menu.
pub fn free_close_window_key() {
    #[cfg(target_os = "macos")]
    imp::free_close_window_key();
}

// Runs from setup, on the main thread.
pub fn show_in_mission_control(window: &WebviewWindow) {
    #[cfg(target_os = "macos")]
    imp::show_in_mission_control(window);
    #[cfg(not(target_os = "macos"))]
    let _ = window;
}

// Runs from the tray's open, on the main thread.
pub fn show_in_panel(window: &WebviewWindow, blurred: fn()) {
    #[cfg(target_os = "macos")]
    imp::show_in_panel(window, blurred);
    #[cfg(not(target_os = "macos"))]
    let _ = (window, blurred);
}

// Runs f on the main dispatch queue after the size and place tao has queued there: tao sets a window's frame
// asynchronously, so the tray's panel copied the frame from before it (the popover stayed at its loading page's 62 pt,
// 2026-10-16). Elsewhere f runs at once.
pub fn after_tao_frame(f: impl FnOnce() + Send + 'static) {
    #[cfg(target_os = "macos")]
    dispatch2::DispatchQueue::main().exec_async(f);
    #[cfg(not(target_os = "macos"))]
    f();
}

// Runs from the tray's place, on the main thread.
pub fn panel_follow(window: &WebviewWindow) {
    #[cfg(target_os = "macos")]
    imp::panel_follow(window);
    #[cfg(not(target_os = "macos"))]
    let _ = window;
}

// Runs from the tray's close, on the main thread, just before the destroy.
pub fn free_when_destroyed(window: &WebviewWindow) {
    #[cfg(target_os = "macos")]
    imp::free_when_destroyed(window);
    #[cfg(not(target_os = "macos"))]
    let _ = window;
}

// Runs from the tray's close before the destroy, and at exit, on the main thread.
pub fn close_panel() {
    #[cfg(target_os = "macos")]
    imp::close_panel();
}

// Runs from the tray's apply, on the main thread, after set_title.
#[cfg(target_os = "macos")]
pub fn tint_tray_alert(tray: &tauri::tray::TrayIcon, title: String) {
    imp::tint_tray_alert(tray, title);
}

// Runs from the tray's open, on the main thread, after show_in_panel.
#[cfg(target_os = "macos")]
pub fn present_from_tray(tray: &tauri::tray::TrayIcon) {
    imp::present_from_tray(tray);
}

// Runs from setup, on the main thread.
pub fn watch_arrivals(app: &tauri::AppHandle) {
    #[cfg(target_os = "macos")]
    imp::watch_arrivals(app);
    #[cfg(not(target_os = "macos"))]
    let _ = app;
}

#[tauri::command]
pub fn set_folded_chrome(window: WebviewWindow, folded: bool) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    return imp::set_folded_chrome(&window, folded);
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (window, folded);
        Ok(())
    }
}

#[tauri::command]
pub fn redirect_minimize(window: WebviewWindow, on: bool) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    return imp::redirect_minimize(&window, on);
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (window, on);
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn folded_in_front() -> Arrival {
        Arrival { active: true, folded: true, has_key: false, visible: true, minimized: false }
    }

    fn grown_back_off_screen() -> Unfolded {
        Unfolded { folded: false, on_active_space: false, visible: true, minimized: false }
    }

    #[test]
    fn a_window_grown_back_off_the_space_on_screen_comes_to_the_front() {
        assert!(brings_to_front(grown_back_off_screen()));
    }

    #[test]
    fn a_window_grown_back_on_the_space_on_screen_stays() {
        assert!(!brings_to_front(Unfolded { on_active_space: true, ..grown_back_off_screen() }));
    }

    #[test]
    fn a_window_folded_again_or_put_away_stays() {
        assert!(!brings_to_front(Unfolded { folded: true, ..grown_back_off_screen() }));
        assert!(!brings_to_front(Unfolded { minimized: true, ..grown_back_off_screen() }));
        assert!(!brings_to_front(Unfolded { visible: false, ..grown_back_off_screen() }));
    }

    #[test]
    fn a_folded_window_in_front_with_no_key_takes_it() {
        assert!(takes_key(folded_in_front()));
    }

    #[test]
    fn a_key_already_given_is_left_alone() {
        assert!(!takes_key(Arrival { has_key: true, ..folded_in_front() }));
    }

    #[test]
    fn only_a_folded_window_takes_it() {
        assert!(!takes_key(Arrival { folded: false, ..folded_in_front() }));
    }

    #[test]
    fn not_while_another_app_is_in_front() {
        assert!(!takes_key(Arrival { active: false, ..folded_in_front() }));
    }

    #[test]
    fn a_minimized_or_hidden_window_is_left_to_the_dock() {
        assert!(!takes_key(Arrival { minimized: true, ..folded_in_front() }));
        assert!(!takes_key(Arrival { visible: false, ..folded_in_front() }));
    }
}
