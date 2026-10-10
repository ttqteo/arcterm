// The float's macOS window chrome (floatstore.ts): hide the traffic lights while the float is folded into Sprout,
// and send the yellow button to Sprout instead of the Dock while floating. Tauri can do neither, so this talks to
// AppKit. Commands that are not async run on the main thread, which AppKit requires; the marker check turns a
// mistake there into an error instead of undefined behaviour. Both are no-ops on other platforms.

use tauri::WebviewWindow;

#[cfg(target_os = "macos")]
mod imp {
    use std::cell::RefCell;
    use std::sync::OnceLock;

    use objc2::rc::Retained;
    use objc2::runtime::{AnyObject, NSObject, Sel};
    use objc2::{define_class, msg_send, sel, MainThreadMarker, MainThreadOnly};
    use objc2_app_kit::{NSWindow, NSWindowButton};
    use tauri::{AppHandle, Emitter, Manager, WebviewWindow};

    static APP: OnceLock<AppHandle> = OnceLock::new();

    define_class!(
        // SAFETY: NSObject has no subclassing requirements, and this class does not implement Drop.
        #[unsafe(super(NSObject))]
        #[thread_kind = MainThreadOnly]
        #[name = "ArcFloatMinimizeTarget"]
        struct MinimizeTarget;

        impl MinimizeTarget {
            #[unsafe(method(minimizeToSprout:))]
            fn minimize_to_sprout(&self, _sender: Option<&AnyObject>) {
                if let Some(app) = APP.get() {
                    let _ = app.emit("float-minimize", ());
                }
            }
        }
    );

    impl MinimizeTarget {
        fn new(mtm: MainThreadMarker) -> Retained<Self> {
            unsafe { msg_send![Self::alloc(mtm), init] }
        }
    }

    // A button holds its target weakly, so the redirect keeps it alive here, with the target and action the button
    // gets back when float ends.
    struct Redirect {
        _target: Retained<MinimizeTarget>,
        original_target: Option<Retained<AnyObject>>,
        original_action: Option<Sel>,
    }

    thread_local! {
        static REDIRECT: RefCell<Option<Redirect>> = const { RefCell::new(None) };
    }

    fn ns_window<'a>(window: &'a WebviewWindow, _mtm: MainThreadMarker) -> Result<&'a NSWindow, String> {
        let ptr = window.ns_window().map_err(|e| e.to_string())?;
        // SAFETY: Tauri hands back this window's live NSWindow*, which outlives the call, and we are on the main thread
        Ok(unsafe { &*(ptr as *const NSWindow) })
    }

    pub fn set_traffic_lights_hidden(window: &WebviewWindow, hidden: bool) -> Result<(), String> {
        let mtm = MainThreadMarker::new().ok_or("not on the main thread")?;
        let ns = ns_window(window, mtm)?;
        for kind in [NSWindowButton::CloseButton, NSWindowButton::MiniaturizeButton, NSWindowButton::ZoomButton] {
            if let Some(button) = ns.standardWindowButton(kind) {
                button.setHidden(hidden);
            }
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
                // SAFETY: the target is kept alive in REDIRECT for as long as the button points at it
                unsafe {
                    button.setTarget(Some(as_object));
                    button.setAction(Some(sel!(minimizeToSprout:)));
                }
                *slot = Some(Redirect { _target: target, original_target, original_action });
            } else if !on {
                if let Some(r) = slot.take() {
                    // SAFETY: these are the button's own target and action from before the redirect
                    unsafe {
                        button.setTarget(r.original_target.as_deref());
                        button.setAction(r.original_action);
                    }
                }
            }
        });
        Ok(())
    }
}

#[tauri::command]
pub fn set_traffic_lights_hidden(window: WebviewWindow, hidden: bool) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    return imp::set_traffic_lights_hidden(&window, hidden);
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (window, hidden);
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
