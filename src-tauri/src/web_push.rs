//! Web Push for the browser-access page: a phone or tablet that added the
//! page to its Home Screen subscribes, and the app sends it the banners the
//! Mac shows (a chat finished, an approval or question waits).
//!
//! Each message is encrypted for that one device (RFC 8291, `aes128gcm`) and
//! signed with this Mac's VAPID key (RFC 8292), so the push service in the
//! middle (Apple's, for an iPhone) only ever relays ciphertext. The browser
//! offers push only on a secure page, so the page has to be opened over
//! HTTPS, e.g. its Tailscale Serve address.

use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use ring::rand::{SecureRandom, SystemRandom};
use ring::signature::{EcdsaKeyPair, KeyPair, ECDSA_P256_SHA256_FIXED_SIGNING};
use ring::{aead, agreement, hkdf};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{AppHandle, Manager};

const KEY_FILE: &str = "web-push-vapid.pk8";
const SUBSCRIPTIONS_FILE: &str = "web-push-subscriptions.json";
/// One record carries the whole message; banners are clipped well below it.
const RECORD_SIZE: u32 = 4096;
const MAX_PAYLOAD: usize = 3000;
const TTL_SECONDS: &str = "86400";
const SEND_TIMEOUT: Duration = Duration::from_secs(15);
/// VAPID wants a contact; the project page stands in for an address.
const SUBJECT: &str = "https://github.com/wegvon/irgatos";
/// Only real push services: a subscription is a URL the Mac will POST to.
const PUSH_HOSTS: [&str; 4] = [
    "push.apple.com",
    "fcm.googleapis.com",
    "push.services.mozilla.com",
    "notify.windows.com",
];

/// Subscriptions and the key file are read and rewritten as a whole.
static FILES: Mutex<()> = Mutex::new(());

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Subscription {
    endpoint: String,
    p256dh: String,
    auth: String,
}

fn data_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path().app_data_dir().map_err(|e| e.to_string())
}

fn b64(bytes: impl AsRef<[u8]>) -> String {
    URL_SAFE_NO_PAD.encode(bytes)
}

/// Browsers hand out keys URL-safe without padding; tolerate either.
fn unb64(text: &str) -> Option<Vec<u8>> {
    URL_SAFE_NO_PAD
        .decode(text.trim().trim_end_matches('='))
        .ok()
}

fn vapid_key(dir: &Path) -> Result<EcdsaKeyPair, String> {
    let path = dir.join(KEY_FILE);
    let rng = SystemRandom::new();
    let pkcs8 = match std::fs::read(&path) {
        Ok(bytes) => bytes,
        Err(_) => {
            let bytes = EcdsaKeyPair::generate_pkcs8(&ECDSA_P256_SHA256_FIXED_SIGNING, &rng)
                .map_err(|_| "could not create the push key".to_string())?;
            std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
            write_private(&path, bytes.as_ref())?;
            bytes.as_ref().to_vec()
        }
    };
    EcdsaKeyPair::from_pkcs8(&ECDSA_P256_SHA256_FIXED_SIGNING, &pkcs8, &rng)
        .map_err(|_| "the push key is unreadable".to_string())
}

fn write_private(path: &Path, bytes: &[u8]) -> Result<(), String> {
    std::fs::write(path, bytes).map_err(|e| e.to_string())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600));
    }
    Ok(())
}

fn load_subscriptions(dir: &Path) -> Vec<Subscription> {
    std::fs::read(dir.join(SUBSCRIPTIONS_FILE))
        .ok()
        .and_then(|bytes| serde_json::from_slice(&bytes).ok())
        .unwrap_or_default()
}

fn save_subscriptions(dir: &Path, subscriptions: &[Subscription]) -> Result<(), String> {
    std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    let bytes = serde_json::to_vec_pretty(subscriptions).map_err(|e| e.to_string())?;
    write_private(&dir.join(SUBSCRIPTIONS_FILE), &bytes)
}

fn push_host_allowed(endpoint: &str) -> bool {
    let Ok(url) = url::Url::parse(endpoint) else {
        return false;
    };
    url.scheme() == "https"
        && url.host_str().is_some_and(|host| {
            PUSH_HOSTS
                .iter()
                .any(|allowed| host == *allowed || host.ends_with(&format!(".{allowed}")))
        })
}

/// What the page sent from `PushSubscription.toJSON()`.
fn parse_subscription(input: &Value) -> Result<Subscription, String> {
    let endpoint = input
        .get("endpoint")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let keys = input.get("keys");
    let key = |name: &str| {
        keys.and_then(|keys| keys.get(name))
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string()
    };
    let (p256dh, auth) = (key("p256dh"), key("auth"));
    if !push_host_allowed(endpoint) {
        return Err("This browser's push service is not supported.".into());
    }
    let public = unb64(&p256dh).unwrap_or_default();
    if public.len() != 65 || public[0] != 4 || unb64(&auth).map(|a| a.len()) != Some(16) {
        return Err("The subscription keys are malformed.".into());
    }
    Ok(Subscription {
        endpoint: endpoint.to_string(),
        p256dh,
        auth,
    })
}

/// Handles the page's own push calls; `None` for every other action.
pub fn handle_web_action(app: &AppHandle, action: &str, input: &Value) -> Option<Value> {
    let reply = match action {
        "pushKey" => public_key(app).map(|key| json!({ "publicKey": key })),
        "pushSubscribe" => parse_subscription(input).and_then(|sub| subscribe(app, sub)),
        "pushUnsubscribe" => unsubscribe(
            app,
            input
                .get("endpoint")
                .and_then(Value::as_str)
                .unwrap_or_default(),
        ),
        _ => return None,
    };
    Some(match reply {
        Ok(result) => json!({ "ok": true, "result": result }),
        Err(error) => json!({ "ok": false, "error": error }),
    })
}

fn public_key(app: &AppHandle) -> Result<String, String> {
    let dir = data_dir(app)?;
    let _guard = FILES.lock().map_err(|_| "busy".to_string())?;
    Ok(b64(vapid_key(&dir)?.public_key()))
}

fn subscribe(app: &AppHandle, subscription: Subscription) -> Result<Value, String> {
    let dir = data_dir(app)?;
    let _guard = FILES.lock().map_err(|_| "busy".to_string())?;
    let mut all = load_subscriptions(&dir);
    all.retain(|known| known.endpoint != subscription.endpoint);
    all.push(subscription);
    save_subscriptions(&dir, &all)?;
    Ok(json!({ "devices": all.len() }))
}

fn unsubscribe(app: &AppHandle, endpoint: &str) -> Result<Value, String> {
    let dir = data_dir(app)?;
    let _guard = FILES.lock().map_err(|_| "busy".to_string())?;
    let mut all = load_subscriptions(&dir);
    all.retain(|known| known.endpoint != endpoint);
    save_subscriptions(&dir, &all)?;
    Ok(json!({ "devices": all.len() }))
}

/// Sends the banner to every subscribed device in the background; a device
/// the push service no longer knows is forgotten. `retire` lists earlier
/// banners (by tag) whose question was settled since: the service worker
/// closes them, since a push of their own would have to show a banner.
#[tauri::command]
pub fn web_push_send(
    app: AppHandle,
    title: String,
    body: String,
    url: String,
    tag: String,
    retire: Option<Vec<String>>,
) {
    let retire = retire.unwrap_or_default();
    let Ok(dir) = data_dir(&app) else {
        return;
    };
    std::thread::spawn(move || {
        let (key, subscriptions) = {
            let Ok(_guard) = FILES.lock() else {
                return;
            };
            let subscriptions = load_subscriptions(&dir);
            if subscriptions.is_empty() {
                return;
            }
            let Ok(key) = vapid_key(&dir) else {
                return;
            };
            (key, subscriptions)
        };
        let payload = payload(&title, &body, &url, &tag, &retire);
        let gone: Vec<String> = subscriptions
            .iter()
            .filter(|sub| match deliver(&key, sub, &payload) {
                Ok(()) => false,
                Err(Delivery::Gone) => true,
                Err(Delivery::Failed(error)) => {
                    eprintln!("[web-push] {error}");
                    false
                }
            })
            .map(|sub| sub.endpoint.clone())
            .collect();
        if gone.is_empty() {
            return;
        }
        if let Ok(_guard) = FILES.lock() {
            let mut all = load_subscriptions(&dir);
            all.retain(|known| !gone.contains(&known.endpoint));
            let _ = save_subscriptions(&dir, &all);
        }
    });
}

fn payload(title: &str, body: &str, url: &str, tag: &str, retire: &[String]) -> Vec<u8> {
    let mut body = body.to_string();
    // Closing old banners matters less than the new one, so they go first.
    let mut retire: Vec<&String> = retire.iter().collect();
    loop {
        let bytes = json!({
            "title": title,
            "body": body,
            "url": url,
            "tag": tag,
            "retire": retire,
        })
        .to_string()
        .into_bytes();
        if bytes.len() <= MAX_PAYLOAD || (body.is_empty() && retire.is_empty()) {
            return bytes;
        }
        if !retire.is_empty() {
            retire.remove(0);
            continue;
        }
        let keep = body.chars().count() * 3 / 4;
        body = body.chars().take(keep).collect::<String>() + "…";
        if keep == 0 {
            body.clear();
        }
    }
}

enum Delivery {
    Gone,
    Failed(String),
}

fn deliver(key: &EcdsaKeyPair, sub: &Subscription, payload: &[u8]) -> Result<(), Delivery> {
    let failed = |error: String| Delivery::Failed(error);
    let body = encrypt(sub, payload).map_err(failed)?;
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let authorization = vapid_authorization(key, &sub.endpoint, now).map_err(failed)?;
    match ureq::post(&sub.endpoint)
        .timeout(SEND_TIMEOUT)
        .set("Authorization", &authorization)
        .set("TTL", TTL_SECONDS)
        .set("Urgency", "high")
        .set("Content-Encoding", "aes128gcm")
        .set("Content-Type", "application/octet-stream")
        .send_bytes(&body)
    {
        Ok(_) => Ok(()),
        Err(ureq::Error::Status(404 | 410, _)) => Err(Delivery::Gone),
        Err(ureq::Error::Status(status, response)) => Err(Delivery::Failed(format!(
            "push service answered {status}: {}",
            response.into_string().unwrap_or_default()
        ))),
        Err(error) => Err(Delivery::Failed(error.to_string())),
    }
}

/// `vapid t=<JWT>, k=<public key>`, the JWT scoped to the push service.
fn vapid_authorization(key: &EcdsaKeyPair, endpoint: &str, now: u64) -> Result<String, String> {
    let audience = url::Url::parse(endpoint)
        .map_err(|e| e.to_string())?
        .origin()
        .ascii_serialization();
    let header = b64(r#"{"typ":"JWT","alg":"ES256"}"#);
    let claims =
        b64(json!({ "aud": audience, "exp": now + 12 * 60 * 60, "sub": SUBJECT }).to_string());
    let signing_input = format!("{header}.{claims}");
    let signature = key
        .sign(&SystemRandom::new(), signing_input.as_bytes())
        .map_err(|_| "could not sign the push request".to_string())?;
    Ok(format!(
        "vapid t={signing_input}.{}, k={}",
        b64(signature),
        b64(key.public_key())
    ))
}

fn encrypt(sub: &Subscription, plaintext: &[u8]) -> Result<Vec<u8>, String> {
    let ua_public = unb64(&sub.p256dh).ok_or("bad p256dh")?;
    let auth = unb64(&sub.auth).ok_or("bad auth")?;
    let rng = SystemRandom::new();
    let ephemeral = agreement::EphemeralPrivateKey::generate(&agreement::ECDH_P256, &rng)
        .map_err(|_| "could not create a message key")?;
    let as_public = ephemeral
        .compute_public_key()
        .map_err(|_| "could not create a message key")?
        .as_ref()
        .to_vec();
    let secret = agreement::agree_ephemeral(
        ephemeral,
        &agreement::UnparsedPublicKey::new(&agreement::ECDH_P256, &ua_public),
        |secret| secret.to_vec(),
    )
    .map_err(|_| "the device key is invalid")?;
    let mut salt = [0u8; 16];
    rng.fill(&mut salt).map_err(|_| "no randomness")?;
    seal(&secret, &auth, &ua_public, &as_public, &salt, plaintext)
}

struct Len(usize);

impl hkdf::KeyType for Len {
    fn len(&self) -> usize {
        self.0
    }
}

fn hkdf_sha256(salt: &[u8], ikm: &[u8], info: &[u8], len: usize) -> Vec<u8> {
    let mut out = vec![0; len];
    hkdf::Salt::new(hkdf::HKDF_SHA256, salt)
        .extract(ikm)
        .expand(&[info], Len(len))
        .and_then(|okm| okm.fill(&mut out))
        .expect("HKDF-SHA256 output is at most 32 bytes here");
    out
}

/// RFC 8291 section 3.4 and RFC 8188: one record, header then ciphertext.
fn seal(
    ecdh_secret: &[u8],
    auth: &[u8],
    ua_public: &[u8],
    as_public: &[u8],
    salt: &[u8; 16],
    plaintext: &[u8],
) -> Result<Vec<u8>, String> {
    let mut key_info = b"WebPush: info\0".to_vec();
    key_info.extend_from_slice(ua_public);
    key_info.extend_from_slice(as_public);
    let ikm = hkdf_sha256(auth, ecdh_secret, &key_info, 32);
    let cek = hkdf_sha256(salt, &ikm, b"Content-Encoding: aes128gcm\0", 16);
    let nonce = hkdf_sha256(salt, &ikm, b"Content-Encoding: nonce\0", 12);
    let key = aead::LessSafeKey::new(
        aead::UnboundKey::new(&aead::AES_128_GCM, &cek).map_err(|_| "bad content key")?,
    );
    let mut record = plaintext.to_vec();
    // Padding delimiter of the last (only) record.
    record.push(2);
    key.seal_in_place_append_tag(
        aead::Nonce::try_assume_unique_for_key(&nonce).map_err(|_| "bad nonce")?,
        aead::Aad::empty(),
        &mut record,
    )
    .map_err(|_| "could not encrypt the message")?;
    let mut out = Vec::with_capacity(21 + as_public.len() + record.len());
    out.extend_from_slice(salt);
    out.extend_from_slice(&RECORD_SIZE.to_be_bytes());
    out.push(as_public.len() as u8);
    out.extend_from_slice(as_public);
    out.extend_from_slice(&record);
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// RFC 8291 appendix A, with its fixed salt and ECDH secret.
    #[test]
    fn matches_the_rfc_8291_example() {
        let ua_public = unb64("BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4").unwrap();
        let as_public = unb64("BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8").unwrap();
        let secret = unb64("kyrL1jIIOHEzg3sM2ZWRHDRB62YACZhhSlknJ672kSs").unwrap();
        let auth = unb64("BTBZMqHH6r4Tts7J_aSIgg").unwrap();
        let salt: [u8; 16] = unb64("DGv6ra1nlYgDCS1FRnbzlw").unwrap().try_into().unwrap();
        let body = seal(
            &secret,
            &auth,
            &ua_public,
            &as_public,
            &salt,
            b"When I grow up, I want to be a watermelon",
        )
        .unwrap();
        assert_eq!(
            b64(body),
            "DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN"
        );
    }

    #[test]
    fn accepts_only_push_services() {
        assert!(push_host_allowed(
            "https://web.push.apple.com/QGuQyavXutnMH"
        ));
        assert!(push_host_allowed("https://fcm.googleapis.com/fcm/send/x"));
        assert!(!push_host_allowed("http://web.push.apple.com/x"));
        assert!(!push_host_allowed(
            "https://evilpush.apple.com.example.org/x"
        ));
        assert!(!push_host_allowed("https://192.168.1.5/x"));
    }

    #[test]
    fn reads_the_page_subscription() {
        let key = b64([4u8; 65]);
        let auth = b64([7u8; 16]);
        let sub = parse_subscription(&json!({
            "endpoint": "https://web.push.apple.com/abc",
            "keys": { "p256dh": key, "auth": auth },
        }))
        .unwrap();
        assert_eq!(sub.endpoint, "https://web.push.apple.com/abc");
        assert!(parse_subscription(&json!({
            "endpoint": "https://web.push.apple.com/abc",
            "keys": { "p256dh": "short", "auth": auth },
        }))
        .is_err());
    }

    #[test]
    fn signs_a_vapid_token_for_the_push_origin() {
        let rng = SystemRandom::new();
        let pkcs8 = EcdsaKeyPair::generate_pkcs8(&ECDSA_P256_SHA256_FIXED_SIGNING, &rng).unwrap();
        let key = EcdsaKeyPair::from_pkcs8(&ECDSA_P256_SHA256_FIXED_SIGNING, pkcs8.as_ref(), &rng)
            .unwrap();
        let header = vapid_authorization(&key, "https://web.push.apple.com/abc", 1_000).unwrap();
        let token = header
            .strip_prefix("vapid t=")
            .and_then(|rest| rest.split(", k=").next())
            .unwrap();
        let parts: Vec<&str> = token.split('.').collect();
        assert_eq!(parts.len(), 3);
        let claims: Value = serde_json::from_slice(&unb64(parts[1]).unwrap()).unwrap();
        assert_eq!(claims["aud"], "https://web.push.apple.com");
        assert_eq!(claims["exp"], 1_000 + 12 * 60 * 60);
        let public = ring::signature::UnparsedPublicKey::new(
            &ring::signature::ECDSA_P256_SHA256_FIXED,
            key.public_key().as_ref(),
        );
        public
            .verify(
                format!("{}.{}", parts[0], parts[1]).as_bytes(),
                &unb64(parts[2]).unwrap(),
            )
            .unwrap();
    }

    #[test]
    fn keeps_the_payload_inside_one_record() {
        let long = "ş".repeat(5000);
        assert!(payload("Irgatos", &long, "/", "t", &[]).len() <= MAX_PAYLOAD);
        let short = payload("Irgatos", "done", "/#/chat/a", "a", &[]);
        let value: Value = serde_json::from_slice(&short).unwrap();
        assert_eq!(value["url"], "/#/chat/a");
    }

    #[test]
    fn retired_tags_ride_along_but_never_crowd_out_the_banner() {
        let retire = vec!["decision:a:approval:1".to_string()];
        let value: Value =
            serde_json::from_slice(&payload("t", "b", "/", "x", &retire)).unwrap();
        assert_eq!(value["retire"][0], "decision:a:approval:1");
        let many: Vec<String> = (0..400).map(|n| format!("decision:s:question:{n}")).collect();
        let bytes = payload("t", "keep me", "/", "x", &many);
        assert!(bytes.len() <= MAX_PAYLOAD);
        let value: Value = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(value["body"], "keep me");
    }

    #[test]
    fn remembers_one_subscription_per_endpoint() {
        let dir = tempfile::tempdir().unwrap();
        let sub = Subscription {
            endpoint: "https://web.push.apple.com/a".into(),
            p256dh: "k".into(),
            auth: "a".into(),
        };
        save_subscriptions(dir.path(), std::slice::from_ref(&sub)).unwrap();
        assert_eq!(load_subscriptions(dir.path()), vec![sub]);
        let key = vapid_key(dir.path()).unwrap();
        let again = vapid_key(dir.path()).unwrap();
        assert_eq!(key.public_key().as_ref(), again.public_key().as_ref());
    }
}
