// The window's macOS chrome (floatstore.ts): while the window is folded into Sprout, hide the traffic lights and put it
// on every Space, beside a full-screen app's too, so Sprout follows you; and send the yellow button and ⌘M to Sprout
// instead of the Dock while window:minimize says so. Tauri can do none of the three, so this talks to AppKit. Commands that are not async run on the main thread, which AppKit requires; the marker check turns a
// mistake there into an error instead of undefined behaviour. Both are no-ops on other platforms. It also takes ⌘W off
// the menu's Close Window, so the key reaches the cockpit, which closes the focused agent with it.

use tauri::WebviewWindow;

#[cfg(target_os = "macos")]
mod imp {
    use std::cell::{Cell, RefCell};
    use std::sync::OnceLock;

    use objc2::rc::Retained;
    use objc2::runtime::{AnyObject, NSObject, Sel};
    use objc2::{define_class, msg_send, sel, MainThreadMarker, MainThreadOnly};
    use objc2_app_kit::{NSApplication, NSMenuItem, NSWindow, NSWindowButton, NSWindowCollectionBehavior};
    use objc2_foundation::ns_string;
    use tauri::{AppHandle, Emitter, Manager, WebviewWindow};

    static APP: OnceLock<AppHandle> = OnceLock::new();

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
    // arcterm and every agent in it, so the items keep their place in the menu but lose the key.
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

    pub fn set_folded_chrome(window: &WebviewWindow, folded: bool) -> Result<(), String> {
        let mtm = MainThreadMarker::new().ok_or("not on the main thread")?;
        let ns = ns_window(window, mtm)?;
        for kind in [NSWindowButton::CloseButton, NSWindowButton::MiniaturizeButton, NSWindowButton::ZoomButton] {
            if let Some(button) = ns.standardWindowButton(kind) {
                button.setHidden(folded);
            }
        }
        // On every Space, and allowed beside a full-screen window. AppKit throws on a behavior that is both full-screen
        // primary and auxiliary, or both joins all Spaces and moves to the active one, so those come off while folded.
        if folded {
            let was = ns.collectionBehavior();
            UNFOLDED_BEHAVIOR.with(|cell| cell.set(Some(cell.get().unwrap_or(was))));
            let mut behavior = was;
            behavior &= !(NSWindowCollectionBehavior::MoveToActiveSpace
                | NSWindowCollectionBehavior::FullScreenPrimary
                | NSWindowCollectionBehavior::FullScreenNone);
            behavior |= NSWindowCollectionBehavior::CanJoinAllSpaces | NSWindowCollectionBehavior::FullScreenAuxiliary;
            ns.setCollectionBehavior(behavior);
        } else if let Some(was) = UNFOLDED_BEHAVIOR.with(|cell| cell.take()) {
            ns.setCollectionBehavior(was);
        }
        Ok(())
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
}

// Runs from setup, on the main thread, once Tauri has installed the app menu.
pub fn free_close_window_key() {
    #[cfg(target_os = "macos")]
    imp::free_close_window_key();
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
