// The clipboard's text for Quick translate's paste suggestion (frontend translatestore.ts checkClipboard). The page cannot
// read it itself: WKWebView's navigator.clipboard.readText() pops a Paste callout the person has to click, and WebView2's
// asks for a permission.
//
// The text is read only when the clipboard changed since the caller's last read (`since`): macOS's change count and
// Windows's sequence number move on with every copy and cost nothing to read, while reading the text itself on a Mac
// makes macOS ask the person whether arcterm may paste from another app, unless they set arcterm to Allow under
// System Settings → Privacy & Security → Paste from Other Apps. Set to Deny, macOS gives arcterm nothing: the answer says
// so (`blocked`), and the panel says how to allow it. A file or an image on the clipboard answers no text (a file
// copied in Finder also carries its name as text), nor does a text longer than MAX_BYTES, which no suggestion would take.

use serde::Serialize;

#[derive(Serialize, Default, Debug, PartialEq)]
pub struct Clip {
    // the clipboard's change count (macOS) or sequence number (Windows); 0 elsewhere
    change: i64,
    // its plain text, read only when `change` differs from `since`; none for no text, a file, an image or a long text
    text: Option<String>,
    // macOS denies arcterm the clipboard (Paste from Other Apps set to Deny)
    blocked: bool,
}

// the suggestion takes a few hundred characters at most (translatemodel.ts SUGGEST_MAX_CHARS)
const MAX_BYTES: usize = 4096;

fn within_limit(text: String) -> Option<String> {
    (text.len() <= MAX_BYTES).then_some(text)
}

#[tauri::command]
pub fn clipboard_text(since: i64) -> Clip {
    read(since)
}

#[cfg(target_os = "macos")]
fn read(since: i64) -> Clip {
    use objc2::rc::Retained;
    use objc2::runtime::{AnyObject, NSObject};
    use objc2::{class, msg_send, sel};
    use objc2_foundation::{ns_string, NSString};

    // NSPasteboardAccessBehaviorAlwaysDeny (NSPasteboard.h, macOS 15.4)
    const ALWAYS_DENY: isize = 3;
    // the types that mean a file or an image is on the clipboard rather than text
    const NOT_TEXT: [&str; 7] = [
        "public.file-url",
        "public.tiff",
        "public.png",
        "public.jpeg",
        "public.heic",
        "com.compuserve.gif",
        "public.svg-image",
    ];

    // SAFETY: generalPasteboard, changeCount, respondsToSelector:, accessBehavior (asked for only where it answers),
    // types, count, objectAtIndex: and stringForType: are NSPasteboard's, NSObject's and NSArray's own
    unsafe {
        let pb: Option<Retained<NSObject>> = msg_send![class!(NSPasteboard), generalPasteboard];
        let Some(pb) = pb else {
            return Clip::default();
        };
        let change: isize = msg_send![&*pb, changeCount];
        let mut clip = Clip {
            change: change as i64,
            ..Clip::default()
        };
        let knows_access: bool = msg_send![&*pb, respondsToSelector: sel!(accessBehavior)];
        if knows_access {
            let access: isize = msg_send![&*pb, accessBehavior];
            if access == ALWAYS_DENY {
                clip.blocked = true;
                return clip;
            }
        }
        if clip.change == since {
            return clip;
        }
        let types: Option<Retained<AnyObject>> = msg_send![&*pb, types];
        if let Some(types) = types {
            let count: usize = msg_send![&*types, count];
            for i in 0..count {
                let t: Retained<NSString> = msg_send![&*types, objectAtIndex: i];
                if NOT_TEXT.contains(&t.to_string().as_str()) {
                    return clip;
                }
            }
        }
        // NSPasteboardTypeString
        let text: Option<Retained<NSString>> =
            msg_send![&*pb, stringForType: ns_string!("public.utf8-plain-text")];
        clip.text = text.and_then(|s| within_limit(s.to_string()));
        clip
    }
}

#[cfg(windows)]
fn read(since: i64) -> Clip {
    use windows_sys::Win32::System::DataExchange::{
        CloseClipboard, GetClipboardData, GetClipboardSequenceNumber, IsClipboardFormatAvailable,
        OpenClipboard,
    };
    use windows_sys::Win32::System::Memory::{GlobalLock, GlobalUnlock};

    // the standard clipboard formats (WinUser.h)
    const CF_BITMAP: u32 = 2;
    const CF_DIB: u32 = 8;
    const CF_UNICODETEXT: u32 = 13;
    const CF_HDROP: u32 = 15;
    const CF_DIBV5: u32 = 17;
    // UTF-16 units read at most before giving up on a text as too long
    const MAX_UNITS: usize = MAX_BYTES;

    // SAFETY: the clipboard is opened for this read alone and closed on every path; the handle GetClipboardData
    // answers is the clipboard's, read only while it is locked and never freed here
    unsafe {
        let mut clip = Clip {
            change: GetClipboardSequenceNumber() as i64,
            ..Clip::default()
        };
        if clip.change == since || IsClipboardFormatAvailable(CF_UNICODETEXT) == 0 {
            return clip;
        }
        if [CF_HDROP, CF_BITMAP, CF_DIB, CF_DIBV5]
            .iter()
            .any(|&f| IsClipboardFormatAvailable(f) != 0)
        {
            return clip;
        }
        if OpenClipboard(std::ptr::null_mut()) == 0 {
            return clip;
        }
        let handle = GetClipboardData(CF_UNICODETEXT);
        if !handle.is_null() {
            let units = GlobalLock(handle) as *const u16;
            if !units.is_null() {
                let mut len = 0;
                while len <= MAX_UNITS && *units.add(len) != 0 {
                    len += 1;
                }
                if len <= MAX_UNITS {
                    let text = String::from_utf16_lossy(std::slice::from_raw_parts(units, len));
                    clip.text = within_limit(text);
                }
                GlobalUnlock(handle);
            }
        }
        CloseClipboard();
        clip
    }
}

#[cfg(not(any(target_os = "macos", windows)))]
fn read(_since: i64) -> Clip {
    Clip::default()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_long_text_is_no_text() {
        assert_eq!(within_limit("word".to_string()), Some("word".to_string()));
        assert_eq!(
            within_limit("x".repeat(MAX_BYTES)),
            Some("x".repeat(MAX_BYTES))
        );
        assert_eq!(within_limit("x".repeat(MAX_BYTES + 1)), None);
    }

    #[test]
    fn the_answer_reads_as_the_frontend_expects() {
        let clip = Clip {
            change: 7,
            text: None,
            blocked: true,
        };
        assert_eq!(
            serde_json::to_string(&clip).unwrap(),
            r#"{"change":7,"text":null,"blocked":true}"#
        );
    }
}
