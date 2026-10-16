//! Lets the user pick an element or drag a region in the in-app browser and
//! snapshots it, so the selection can go to an agent as page context.
//!
//! The browser has no IPC. The picker runs in an isolated script world that
//! page scripts can't reach, and only while selection mode is on; the app pulls
//! its result by evaluating `take()` there. Everything it returns came from an
//! untrusted page, so the payload is size-bounded, parsed strictly and clipped.

use std::{cell::RefCell, collections::HashMap, rc::Rc, sync::mpsc, time::Duration};

use base64::Engine as _;
use serde::{Deserialize, Serialize};
use tauri::WebviewWindow;
use wry::WebView;

use crate::browser::{on_main, VIEWS};

const PICKER_JS: &str = include_str!("browser_picker.js");
const POLL_JS: &str = r#"(() => { const picker = globalThis.__irgatPicker; return picker ? picker.take() : '{"state":"missing"}'; })()"#;
const STOP_JS: &str = "globalThis.__irgatPicker?.stop()";
#[cfg_attr(not(any(target_os = "macos", target_os = "linux")), allow(dead_code))]
const WORLD: &str = "irgat-picker";

const MAX_PAYLOAD_BYTES: usize = 64 * 1024;
const MAX_ELEMENTS: usize = 12;
const MAX_ATTRIBUTES: usize = 16;
const MAX_STYLES: usize = 48;
const MAX_PARENT_STYLES: usize = 12;
const MAX_VIEWPORT: f64 = 20_000.0;
/// Longest side of a sent screenshot; larger captures are scaled down.
const MAX_IMAGE_EDGE: u32 = 2000;
const NATIVE_TIMEOUT: Duration = Duration::from_secs(5);

type ViewKey = (String, String);

thread_local! {
    // Views with selection mode on, each holding its picker's script world.
    // WebKit discards a named world, and everything the picker kept in it,
    // once nothing holds it. Polls for any other view read nothing.
    static ACTIVE: RefCell<HashMap<ViewKey, Rc<platform::World>>> = RefCell::default();
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum SelectionKind {
    Element,
    Region,
}

#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize, PartialEq)]
pub struct Size {
    width: f64,
    height: f64,
}

#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize, PartialEq)]
pub struct PageRect {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize, PartialEq)]
pub struct ElementBrief {
    #[serde(default)]
    label: String,
    #[serde(default)]
    selector: String,
    #[serde(default)]
    tag: String,
    #[serde(default)]
    text: String,
    #[serde(default)]
    rect: PageRect,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize, PartialEq)]
pub struct ParentLayout {
    #[serde(default)]
    label: String,
    #[serde(default)]
    styles: Vec<(String, String)>,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize, PartialEq)]
pub struct ElementDetails {
    #[serde(flatten)]
    brief: ElementBrief,
    #[serde(default)]
    attributes: Vec<(String, String)>,
    #[serde(default)]
    styles: Vec<(String, String)>,
    #[serde(default)]
    parent: Option<ParentLayout>,
}

/// What the user picked, as sent to the panel. Rects are CSS pixels in the
/// page's viewport.
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PageSelection {
    kind: SelectionKind,
    #[serde(default)]
    url: String,
    #[serde(default)]
    title: String,
    viewport: Size,
    rect: PageRect,
    #[serde(default)]
    element: Option<ElementDetails>,
    #[serde(default)]
    container: Option<ElementBrief>,
    #[serde(default)]
    elements: Vec<ElementBrief>,
}

#[derive(Deserialize)]
#[serde(tag = "state", rename_all = "camelCase")]
enum PageReply {
    Active,
    Missing,
    Cancelled,
    Picked { selection: Box<PageSelection> },
}

#[derive(Debug, Serialize, PartialEq)]
#[serde(tag = "state", rename_all = "camelCase")]
pub enum PickerPoll {
    Active,
    Cancelled,
    Picked { selection: Box<PageSelection> },
}

/// Part of the view to capture, in the page's CSS pixels.
#[derive(Clone, Copy, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CaptureRect {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    viewport_width: f64,
}

/// Collapse whitespace, drop control characters and cap the length.
fn clip(value: &str, max_chars: usize) -> String {
    let text = value
        .split(|c: char| c.is_whitespace() || c.is_control())
        .filter(|word| !word.is_empty())
        .collect::<Vec<_>>()
        .join(" ");
    if text.chars().count() <= max_chars {
        return text;
    }
    let mut out: String = text.chars().take(max_chars.saturating_sub(1)).collect();
    out.push('…');
    out
}

fn is_name(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 40
        && value
            .bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
}

fn number(value: f64) -> f64 {
    if value.is_finite() {
        value.clamp(-1_000_000.0, 1_000_000.0).round()
    } else {
        0.0
    }
}

fn clean_rect(rect: PageRect) -> PageRect {
    PageRect {
        x: number(rect.x),
        y: number(rect.y),
        width: number(rect.width).max(0.0),
        height: number(rect.height).max(0.0),
    }
}

fn clean_pairs(pairs: Vec<(String, String)>, max: usize) -> Vec<(String, String)> {
    pairs
        .into_iter()
        .filter(|(name, _)| is_name(name))
        .take(max)
        .map(|(name, value)| (name, clip(&value, 200)))
        .filter(|(_, value)| !value.is_empty())
        .collect()
}

fn clean_brief(brief: ElementBrief, text_limit: usize) -> ElementBrief {
    let tag = brief.tag.to_ascii_lowercase();
    ElementBrief {
        label: clip(&brief.label, 120),
        selector: clip(&brief.selector, 600),
        tag: if is_name(&tag) { tag } else { "element".into() },
        text: clip(&brief.text, text_limit),
        rect: clean_rect(brief.rect),
    }
}

impl PageSelection {
    /// Bound and normalize a selection from the page, stamping the address the
    /// browser reports rather than any the page claims.
    fn sanitized(self, url: String) -> Result<Self, String> {
        let invalid = || "The page sent an invalid selection".to_string();
        let Size { width, height } = self.viewport;
        if !(width.is_finite()
            && height.is_finite()
            && (1.0..=MAX_VIEWPORT).contains(&width)
            && (1.0..=MAX_VIEWPORT).contains(&height))
        {
            return Err(invalid());
        }
        let r = self.rect;
        if ![r.x, r.y, r.width, r.height].iter().all(|n| n.is_finite()) {
            return Err(invalid());
        }
        let x = r.x.clamp(0.0, width);
        let y = r.y.clamp(0.0, height);
        let right = (r.x + r.width).clamp(0.0, width);
        let bottom = (r.y + r.height).clamp(0.0, height);
        if right - x < 1.0 || bottom - y < 1.0 {
            return Err("The selection is outside the visible page".into());
        }
        let element = match self.kind {
            SelectionKind::Element => {
                let element = self.element.ok_or_else(invalid)?;
                Some(ElementDetails {
                    brief: clean_brief(element.brief, 400),
                    attributes: clean_pairs(element.attributes, MAX_ATTRIBUTES),
                    styles: clean_pairs(element.styles, MAX_STYLES),
                    parent: element.parent.map(|parent| ParentLayout {
                        label: clip(&parent.label, 120),
                        styles: clean_pairs(parent.styles, MAX_PARENT_STYLES),
                    }),
                })
            }
            SelectionKind::Region => None,
        };
        Ok(Self {
            kind: self.kind,
            url,
            title: clip(&self.title, 200),
            viewport: Size {
                width: width.round(),
                height: height.round(),
            },
            rect: PageRect {
                x: x.round(),
                y: y.round(),
                width: (right - x).round(),
                height: (bottom - y).round(),
            },
            element,
            container: self.container.map(|brief| clean_brief(brief, 120)),
            elements: self
                .elements
                .into_iter()
                .take(MAX_ELEMENTS)
                .map(|brief| clean_brief(brief, 120))
                .collect(),
        })
    }
}

fn parse_reply(raw: &str) -> Result<PageReply, String> {
    if raw.len() > MAX_PAYLOAD_BYTES {
        return Err("The selection is too large to send".into());
    }
    serde_json::from_str(raw).map_err(|_| "The page sent an invalid selection".into())
}

/// RGBA pixels, 4 bytes each, rows top to bottom.
#[derive(Debug, PartialEq)]
pub(crate) struct Rgba {
    pub(crate) width: u32,
    pub(crate) height: u32,
    pixels: Vec<u8>,
}

#[cfg(any(target_os = "macos", test))]
fn decode_png(bytes: &[u8]) -> Result<Rgba, String> {
    let fail = |_| "The page snapshot couldn't be read".to_string();
    let mut decoder = png::Decoder::new(std::io::Cursor::new(bytes));
    decoder.set_transformations(
        png::Transformations::normalize_to_color8() | png::Transformations::ALPHA,
    );
    let mut reader = decoder.read_info().map_err(fail)?;
    let mut buf = vec![
        0;
        reader
            .output_buffer_size()
            .ok_or("The page snapshot is too large")?
    ];
    let info = reader.next_frame(&mut buf).map_err(fail)?;
    let pixels = match info.color_type {
        png::ColorType::Rgba => buf[..info.buffer_size()].to_vec(),
        png::ColorType::GrayscaleAlpha => buf[..info.buffer_size()]
            .as_chunks::<2>()
            .0
            .iter()
            .flat_map(|&[gray, alpha]| [gray, gray, gray, alpha])
            .collect(),
        _ => return Err("The page snapshot has an unexpected format".into()),
    };
    Ok(Rgba {
        width: info.width,
        height: info.height,
        pixels,
    })
}

pub(crate) fn encode_png(image: &Rgba) -> Result<Vec<u8>, String> {
    let mut out = Vec::new();
    {
        let mut encoder = png::Encoder::new(&mut out, image.width, image.height);
        encoder.set_color(png::ColorType::Rgba);
        encoder.set_depth(png::BitDepth::Eight);
        let mut writer = encoder.write_header().map_err(|e| e.to_string())?;
        writer
            .write_image_data(&image.pixels)
            .map_err(|e| e.to_string())?;
    }
    Ok(out)
}

/// Cut `rect` out of a snapshot of the whole view. The snapshot may be at any
/// pixel density, so the scale comes from its width against the viewport's.
fn crop(image: &Rgba, rect: CaptureRect) -> Result<Rgba, String> {
    let values = [rect.x, rect.y, rect.width, rect.height, rect.viewport_width];
    if !values.iter().all(|n| n.is_finite()) || rect.viewport_width < 1.0 {
        return Err("Invalid capture area".into());
    }
    let scale = f64::from(image.width) / rect.viewport_width;
    let to_x = |v: f64| (v * scale).clamp(0.0, f64::from(image.width));
    let to_y = |v: f64| (v * scale).clamp(0.0, f64::from(image.height));
    let left = to_x(rect.x).floor() as u32;
    let top = to_y(rect.y).floor() as u32;
    let right = to_x(rect.x + rect.width).ceil() as u32;
    let bottom = to_y(rect.y + rect.height).ceil() as u32;
    if right <= left || bottom <= top {
        return Err("The selection is outside the visible page".into());
    }
    let (width, height) = (right - left, bottom - top);
    let stride = image.width as usize * 4;
    let mut pixels = Vec::with_capacity(width as usize * height as usize * 4);
    for row in top..bottom {
        let start = row as usize * stride + left as usize * 4;
        pixels.extend_from_slice(&image.pixels[start..start + width as usize * 4]);
    }
    Ok(Rgba {
        width,
        height,
        pixels,
    })
}

/// Box-filter down by a whole factor until the longest side fits `max_edge`.
pub(crate) fn shrink(image: Rgba, max_edge: u32) -> Rgba {
    let factor = image.width.max(image.height).div_ceil(max_edge);
    if factor <= 1 {
        return image;
    }
    let width = (image.width / factor).max(1);
    let height = (image.height / factor).max(1);
    let mut pixels = Vec::with_capacity(width as usize * height as usize * 4);
    for y in 0..height {
        for x in 0..width {
            let mut sum = [0u32; 4];
            for dy in 0..factor {
                for dx in 0..factor {
                    let i = (((y * factor + dy) * image.width + x * factor + dx) * 4) as usize;
                    for (channel, total) in sum.iter_mut().enumerate() {
                        *total += u32::from(image.pixels[i + channel]);
                    }
                }
            }
            let count = factor * factor;
            pixels.extend(sum.map(|total| (total / count) as u8));
        }
    }
    Rgba {
        width,
        height,
        pixels,
    }
}

fn view_key(window: &WebviewWindow, id: &str) -> ViewKey {
    (window.label().to_string(), id.to_string())
}

fn with_view<T>(
    key: &ViewKey,
    task: impl FnOnce(&WebView) -> Result<T, String>,
) -> Result<T, String> {
    VIEWS.with(|views| task(views.borrow().get(key).ok_or("The browser is closed")?))
}

fn active_world(key: &ViewKey) -> Option<Rc<platform::World>> {
    ACTIVE.with(|active| active.borrow().get(key).cloned())
}

fn deactivate(key: &ViewKey) -> Option<Rc<platform::World>> {
    ACTIVE.with(|active| active.borrow_mut().remove(key))
}

/// End selection mode and take the picker off the page. The world is kept
/// until the page has run the stop.
fn stop(key: &ViewKey) {
    if let Some(world) = deactivate(key) {
        let held = world.clone();
        let _ = with_view(key, |view| {
            world.evaluate(view, STOP_JS, move |_| drop(held))
        });
    }
}

async fn wait<T: Send + 'static>(rx: mpsc::Receiver<Result<T, String>>) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(move || rx.recv_timeout(NATIVE_TIMEOUT))
        .await
        .map_err(|e| e.to_string())?
        .map_err(|_| "The browser didn't respond".to_string())?
}

/// Turn the page's reply to a poll into the panel's answer. Runs on the main
/// thread, from the evaluation's completion.
fn settle(key: &ViewKey, raw: Option<String>) -> Result<PickerPoll, String> {
    let Some(world) = active_world(key) else {
        return Ok(PickerPoll::Cancelled);
    };
    let reply = match raw {
        Some(raw) => parse_reply(&raw),
        // The page navigated or hadn't finished loading; arm it again below.
        None => Ok(PageReply::Missing),
    };
    match reply {
        Ok(PageReply::Active) => Ok(PickerPoll::Active),
        Ok(PageReply::Missing) => {
            with_view(key, |view| world.evaluate(view, PICKER_JS, |_| {}))?;
            Ok(PickerPoll::Active)
        }
        Ok(PageReply::Cancelled) => {
            deactivate(key);
            Ok(PickerPoll::Cancelled)
        }
        Ok(PageReply::Picked { selection }) => {
            deactivate(key);
            let url = with_view(key, |view| view.url().map_err(|e| e.to_string()))?;
            Ok(PickerPoll::Picked {
                selection: Box::new(selection.sanitized(url)?),
            })
        }
        Err(error) => {
            stop(key);
            Err(error)
        }
    }
}

/// Turn on selection mode: draw the picker over the page and focus the view
/// so Escape reaches it.
#[tauri::command]
pub async fn browser_picker_start(window: WebviewWindow, id: String) -> Result<(), String> {
    on_main(window, move |window| {
        let key = view_key(&window, &id);
        let world = with_view(&key, |view| {
            let world = Rc::new(platform::World::new(view)?);
            world.evaluate(view, PICKER_JS, |_| {})?;
            let _ = view.focus();
            Ok(world)
        })?;
        ACTIVE.with(|active| active.borrow_mut().insert(key, world));
        Ok(())
    })
    .await
}

#[tauri::command]
pub async fn browser_picker_stop(window: WebviewWindow, id: String) -> Result<(), String> {
    on_main(window, move |window| {
        stop(&view_key(&window, &id));
        Ok(())
    })
    .await
}

/// Read the picker's state. Selection mode ends once it reports a pick or a
/// cancel.
#[tauri::command]
pub async fn browser_picker_poll(window: WebviewWindow, id: String) -> Result<PickerPoll, String> {
    let app_view = window.clone();
    let rx = on_main(window, move |window| {
        let key = view_key(&window, &id);
        let Some(world) = active_world(&key) else {
            return Ok(None);
        };
        let (tx, rx) = mpsc::channel();
        let settle_key = key.clone();
        with_view(&key, move |view| {
            world.evaluate(view, POLL_JS, move |raw| {
                let _ = tx.send(settle(&settle_key, raw));
            })
        })?;
        Ok(Some(rx))
    })
    .await?;
    let poll = match rx {
        Some(rx) => wait(rx).await?,
        None => return Ok(PickerPoll::Cancelled),
    };
    if poll != PickerPoll::Active {
        // The click left keyboard focus in the page; give it back to the app.
        let _ = AsRef::<tauri::Webview>::as_ref(&app_view).set_focus();
    }
    Ok(poll)
}

/// A PNG of part of the visible page, base64-encoded.
#[tauri::command]
pub async fn browser_capture(
    window: WebviewWindow,
    id: String,
    rect: CaptureRect,
) -> Result<String, String> {
    let rx = on_main(window, move |window| {
        let (tx, rx) = mpsc::channel();
        with_view(&view_key(&window, &id), move |view| {
            platform::snapshot(view, move |image| {
                let _ = tx.send(image);
            })
        })?;
        Ok(rx)
    })
    .await?;
    let image = wait(rx).await?;
    tauri::async_runtime::spawn_blocking(move || {
        let png = encode_png(&shrink(crop(&image, rect)?, MAX_IMAGE_EDGE))?;
        Ok(base64::engine::general_purpose::STANDARD.encode(png))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(target_os = "macos")]
pub(crate) mod platform {
    use std::cell::Cell;

    use block2::RcBlock;
    use objc2::{rc::Retained, runtime::AnyObject, MainThreadMarker};
    use objc2_app_kit::{NSBitmapImageFileType, NSBitmapImageRep, NSImage};
    use objc2_foundation::{NSDictionary, NSError, NSString};
    use objc2_web_kit::WKContentWorld;
    use wry::{WebView, WebViewExtMacOS};

    use super::{decode_png, Rgba, WORLD};

    /// The picker's content world, alive for as long as this is.
    pub struct World(Retained<WKContentWorld>);

    impl World {
        pub fn new(_: &WebView) -> Result<Self, String> {
            let mtm =
                MainThreadMarker::new().ok_or("The browser must be used on the main thread")?;
            Ok(Self(unsafe {
                WKContentWorld::worldWithName(&NSString::from_str(WORLD), mtm)
            }))
        }

        /// Evaluate `script` in this world; `done` gets its string result, or
        /// `None` when it threw or returned something else.
        pub fn evaluate(
            &self,
            view: &WebView,
            script: &str,
            done: impl FnOnce(Option<String>) + 'static,
        ) -> Result<(), String> {
            let done = Cell::new(Some(done));
            let handler = RcBlock::new(move |result: *mut AnyObject, _: *mut NSError| {
                let text = unsafe { result.as_ref() }
                    .and_then(|value| value.downcast_ref::<NSString>())
                    .map(|value| value.to_string());
                if let Some(done) = done.take() {
                    done(text);
                }
            });
            unsafe {
                view.webview()
                    .evaluateJavaScript_inFrame_inContentWorld_completionHandler(
                        &NSString::from_str(script),
                        None,
                        &self.0,
                        Some(&handler),
                    );
            }
            Ok(())
        }
    }

    /// Snapshot the visible page at the screen's pixel density.
    pub fn snapshot(
        view: &WebView,
        done: impl FnOnce(Result<Rgba, String>) + 'static,
    ) -> Result<(), String> {
        let done = Cell::new(Some(done));
        let handler = RcBlock::new(move |image: *mut NSImage, _: *mut NSError| {
            let result = unsafe { image.as_ref() }
                .ok_or_else(|| "The page couldn't be captured".to_string())
                .and_then(png_of)
                .and_then(|png| decode_png(&png));
            if let Some(done) = done.take() {
                done(result);
            }
        });
        unsafe {
            view.webview()
                .takeSnapshotWithConfiguration_completionHandler(None, &handler);
        }
        Ok(())
    }

    fn png_of(image: &NSImage) -> Result<Vec<u8>, String> {
        let fail = || "The page snapshot couldn't be read".to_string();
        let tiff = image.TIFFRepresentation().ok_or_else(fail)?;
        let rep = NSBitmapImageRep::imageRepWithData(&tiff).ok_or_else(fail)?;
        let png = unsafe {
            rep.representationUsingType_properties(NSBitmapImageFileType::PNG, &NSDictionary::new())
        }
        .ok_or_else(fail)?;
        Ok(png.to_vec())
    }
}

#[cfg(target_os = "linux")]
pub(crate) mod platform {
    use javascriptcore::ValueExt;
    use webkit2gtk::{
        gio::Cancellable, SnapshotOptions, SnapshotRegion, UserContentInjectedFrames,
        UserContentManager, UserContentManagerExt, UserScript, UserScriptInjectionTime, WebViewExt,
    };
    use wry::{WebView, WebViewExtUnix};

    use super::{Rgba, WORLD};

    /// The picker's script world, alive for as long as this is. WebKitGTK
    /// only keeps a named world while something registered in it exists, so
    /// this registers an empty script there.
    pub struct World {
        manager: UserContentManager,
        script: UserScript,
    }

    impl World {
        pub fn new(view: &WebView) -> Result<Self, String> {
            let manager = view
                .webview()
                .user_content_manager()
                .ok_or("The browser can't run the picker")?;
            let script = UserScript::for_world(
                "",
                UserContentInjectedFrames::TopFrame,
                UserScriptInjectionTime::End,
                WORLD,
                &[],
                &[],
            );
            manager.add_script(&script);
            Ok(Self { manager, script })
        }

        /// Evaluate `script` in this world; `done` gets its string result, or
        /// `None` when it threw or returned something else.
        pub fn evaluate(
            &self,
            view: &WebView,
            script: &str,
            done: impl FnOnce(Option<String>) + 'static,
        ) -> Result<(), String> {
            view.webview().evaluate_javascript(
                script,
                Some(WORLD),
                None,
                None::<&Cancellable>,
                move |result| {
                    done(
                        result
                            .ok()
                            .filter(|value| value.is_string())
                            .map(|value| value.to_str().to_string()),
                    )
                },
            );
            Ok(())
        }
    }

    impl Drop for World {
        fn drop(&mut self) {
            self.manager.remove_script(&self.script);
        }
    }

    /// Snapshot the visible page at the screen's pixel density.
    pub fn snapshot(
        view: &WebView,
        done: impl FnOnce(Result<Rgba, String>) + 'static,
    ) -> Result<(), String> {
        view.webview().snapshot(
            SnapshotRegion::Visible,
            SnapshotOptions::NONE,
            None::<&Cancellable>,
            move |result| done(result.map_err(|e| e.to_string()).and_then(rgba_of)),
        );
        Ok(())
    }

    /// Cairo's ARGB32 is premultiplied and native-endian.
    fn rgba_of(surface: cairo::Surface) -> Result<Rgba, String> {
        let fail = || "The page snapshot couldn't be read".to_string();
        let image = cairo::ImageSurface::try_from(surface).map_err(|_| fail())?;
        let opaque = match image.format() {
            cairo::Format::ARgb32 => false,
            cairo::Format::Rgb24 => true,
            _ => return Err(fail()),
        };
        let width = u32::try_from(image.width()).map_err(|_| fail())?;
        let height = u32::try_from(image.height()).map_err(|_| fail())?;
        let stride = usize::try_from(image.stride()).map_err(|_| fail())?;
        let mut pixels = Vec::with_capacity(width as usize * height as usize * 4);
        image
            .with_data(|data| {
                for row in data.chunks(stride).take(height as usize) {
                    for &px in row.as_chunks::<4>().0.iter().take(width as usize) {
                        let px = u32::from_ne_bytes(px);
                        let alpha = if opaque { 255 } else { px >> 24 };
                        let channel = |shift: u32| {
                            let value = (px >> shift) & 0xff;
                            match alpha {
                                0 => 0,
                                255 => value as u8,
                                _ => ((value * 255 + alpha / 2) / alpha).min(255) as u8,
                            }
                        };
                        pixels.extend([channel(16), channel(8), channel(0), alpha as u8]);
                    }
                }
            })
            .map_err(|_| fail())?;
        Ok(Rgba {
            width,
            height,
            pixels,
        })
    }
}

#[cfg(not(any(target_os = "macos", target_os = "linux")))]
pub(crate) mod platform {
    use wry::WebView;

    use super::Rgba;

    const UNSUPPORTED: &str = "Selecting page content isn't available on this system yet";

    pub struct World;

    impl World {
        pub fn new(_: &WebView) -> Result<Self, String> {
            Err(UNSUPPORTED.into())
        }

        pub fn evaluate(
            &self,
            _: &WebView,
            _: &str,
            _: impl FnOnce(Option<String>) + 'static,
        ) -> Result<(), String> {
            Err(UNSUPPORTED.into())
        }
    }

    pub fn snapshot(
        _: &WebView,
        _: impl FnOnce(Result<Rgba, String>) + 'static,
    ) -> Result<(), String> {
        Err(UNSUPPORTED.into())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn element_reply() -> String {
        serde_json::json!({
            "state": "picked",
            "selection": {
                "kind": "element",
                "url": "https://evil.test/claimed",
                "title": "Pricing\n\u{0007} page",
                "viewport": { "width": 1280, "height": 720 },
                "rect": { "x": 100.4, "y": 690, "width": 240, "height": 80 },
                "element": {
                    "label": "button.cta",
                    "selector": "main > button.cta",
                    "tag": "BUTTON",
                    "text": "  Get   started  ",
                    "rect": { "x": 100, "y": 690, "width": 240, "height": 80 },
                    "attributes": [["type", "submit"], ["on click", "x"], ["title", ""]],
                    "styles": [["display", "inline-flex"], ["Color", "red"]],
                    "parent": { "label": "div.actions", "styles": [["display", "flex"]] },
                    "extra": "ignored"
                },
                "elements": []
            }
        })
        .to_string()
    }

    #[test]
    fn page_replies_are_parsed_strictly_and_bounded() {
        assert!(matches!(
            parse_reply(r#"{"state":"active"}"#),
            Ok(PageReply::Active)
        ));
        assert!(matches!(
            parse_reply(r#"{"state":"cancelled"}"#),
            Ok(PageReply::Cancelled)
        ));
        for bad in [
            "",
            "null",
            r#"{"state":"hacked"}"#,
            r#"{"state":"picked"}"#,
            "[1,2]",
        ] {
            assert!(parse_reply(bad).is_err(), "{bad}");
        }
        let huge = format!(
            r#"{{"state":"active","pad":"{}"}}"#,
            "x".repeat(MAX_PAYLOAD_BYTES)
        );
        assert_eq!(
            parse_reply(&huge).err().as_deref(),
            Some("The selection is too large to send")
        );
    }

    #[test]
    fn selections_are_clipped_to_the_viewport_and_cleaned() {
        let Ok(PageReply::Picked { selection }) = parse_reply(&element_reply()) else {
            panic!("picked");
        };
        let clean = selection
            .sanitized("https://site.test/pricing".into())
            .unwrap();
        assert_eq!(clean.url, "https://site.test/pricing");
        assert_eq!(clean.title, "Pricing page");
        assert_eq!(
            clean.rect,
            PageRect {
                x: 100.0,
                y: 690.0,
                width: 240.0,
                height: 30.0
            }
        );
        let element = clean.element.unwrap();
        assert_eq!(element.brief.tag, "button");
        assert_eq!(element.brief.text, "Get started");
        assert_eq!(element.attributes, vec![("type".into(), "submit".into())]);
        assert_eq!(
            element.styles,
            vec![("display".into(), "inline-flex".into())]
        );
        assert_eq!(element.parent.unwrap().label, "div.actions");
    }

    #[test]
    fn rejects_selections_outside_the_page_or_missing_their_element() {
        let base = |rect: serde_json::Value, element: serde_json::Value| {
            serde_json::from_value::<PageSelection>(serde_json::json!({
                "kind": "element",
                "viewport": { "width": 800, "height": 600 },
                "rect": rect,
                "element": element,
            }))
            .unwrap()
        };
        let element = serde_json::json!({ "tag": "div" });
        let outside = base(
            serde_json::json!({ "x": 900, "y": 10, "width": 50, "height": 50 }),
            element.clone(),
        );
        assert!(outside.sanitized(String::new()).is_err());
        let missing = base(
            serde_json::json!({ "x": 0, "y": 0, "width": 50, "height": 50 }),
            serde_json::Value::Null,
        );
        assert!(missing.sanitized(String::new()).is_err());
        let mut huge = base(
            serde_json::json!({ "x": 0, "y": 0, "width": 50, "height": 50 }),
            element,
        );
        huge.viewport.width = f64::INFINITY;
        assert!(huge.sanitized(String::new()).is_err());
    }

    #[test]
    fn caps_region_elements_and_long_text() {
        let brief = ElementBrief {
            label: "a".repeat(500),
            text: "word ".repeat(200),
            tag: "<script>".into(),
            ..ElementBrief::default()
        };
        let selection = PageSelection {
            kind: SelectionKind::Region,
            url: String::new(),
            title: String::new(),
            viewport: Size {
                width: 800.0,
                height: 600.0,
            },
            rect: PageRect {
                x: 10.0,
                y: 10.0,
                width: 100.0,
                height: 100.0,
            },
            element: Some(ElementDetails::default()),
            container: None,
            elements: vec![brief; 40],
        };
        let clean = selection.sanitized(String::new()).unwrap();
        assert!(clean.element.is_none());
        assert_eq!(clean.elements.len(), MAX_ELEMENTS);
        assert_eq!(clean.elements[0].tag, "element");
        assert_eq!(clean.elements[0].label.chars().count(), 120);
        assert!(clean.elements[0].text.ends_with('…'));
        assert!(clean.elements[0].text.chars().count() <= 120);
    }

    #[test]
    fn clip_collapses_whitespace_and_caps_length() {
        assert_eq!(clip("  a \n\t b  ", 10), "a b");
        assert_eq!(clip("abcdef", 4), "abc…");
        assert_eq!(clip("ab cd", 5), "ab cd");
        assert_eq!(clip("\u{0000}x\u{001b}y", 10), "x y");
    }

    fn checker(width: u32, height: u32) -> Rgba {
        let mut pixels = Vec::new();
        for y in 0..height {
            for x in 0..width {
                pixels.extend([x as u8, y as u8, 7, 255]);
            }
        }
        Rgba {
            width,
            height,
            pixels,
        }
    }

    #[test]
    fn crops_at_the_snapshot_pixel_density() {
        // A 2x snapshot of a 50-pixel-wide viewport.
        let image = checker(100, 60);
        let rect = CaptureRect {
            x: 10.0,
            y: 5.0,
            width: 20.0,
            height: 10.0,
            viewport_width: 50.0,
        };
        let out = crop(&image, rect).unwrap();
        assert_eq!((out.width, out.height), (40, 20));
        assert_eq!(&out.pixels[..4], &[20, 10, 7, 255]);

        let past_edge = CaptureRect {
            x: 45.0,
            width: 30.0,
            ..rect
        };
        assert_eq!(crop(&image, past_edge).unwrap().width, 10);
        let outside = CaptureRect { x: 60.0, ..rect };
        assert!(crop(&image, outside).is_err());
        let invalid = CaptureRect {
            viewport_width: 0.0,
            ..rect
        };
        assert!(crop(&image, invalid).is_err());
    }

    #[test]
    fn shrinks_large_captures_and_round_trips_png() {
        let small = checker(30, 20);
        assert_eq!(shrink(checker(30, 20), 40), small);
        let out = shrink(checker(90, 40), 40);
        assert_eq!((out.width, out.height), (30, 13));
        assert_eq!(&out.pixels[..4], &[1, 1, 7, 255]);

        let png = encode_png(&small).unwrap();
        assert_eq!(decode_png(&png).unwrap(), small);
        assert!(decode_png(b"not a png").is_err());
    }
}
