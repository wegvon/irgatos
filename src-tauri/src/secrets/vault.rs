//! Secret storage: one SQLite file beside the app's other data, holding each
//! value only as AES-256-GCM ciphertext. The key never touches the file; the
//! caller loads it from the macOS Keychain (see `super::keychain_key`).
//!
//! Rows carry what a value may be used for (hosts, where in a request, an
//! optional purpose and use count) and when it lapses. The audit table names
//! which secret was used where, never the value.

use std::path::Path;

use ring::aead::{Aad, LessSafeKey, Nonce, UnboundKey, AES_256_GCM, NONCE_LEN};
use ring::rand::{SecureRandom, SystemRandom};
use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;
use zeroize::Zeroizing;

/// Audit rows kept; older ones are dropped as new ones arrive.
const AUDIT_KEEP: i64 = 1_000;

pub struct Vault {
    conn: Connection,
    key: LessSafeKey,
}

/// What may be known about a secret: everything but its value.
#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SecretMeta {
    pub id: String,
    pub name: String,
    pub label: String,
    pub description: String,
    /// The chat it belongs to; `None` for a value saved for every chat.
    pub session_id: Option<String>,
    pub hosts: Vec<String>,
    /// Where a placeholder may be filled in: "header", "url", "body".
    pub allow_in: Vec<String>,
    pub purpose: Option<String>,
    pub max_uses: Option<u32>,
    pub uses: u32,
    pub created_at: i64,
    pub expires_at: Option<i64>,
}

impl SecretMeta {
    pub fn persistent(&self) -> bool {
        self.session_id.is_none()
    }
    pub fn usable_at(&self, now: i64) -> bool {
        self.expires_at.is_none_or(|at| at > now) && self.max_uses.is_none_or(|max| self.uses < max)
    }
}

/// A new secret, minus its value.
pub struct NewSecret {
    pub name: String,
    pub label: String,
    pub description: String,
    pub session_id: Option<String>,
    pub hosts: Vec<String>,
    pub allow_in: Vec<String>,
    pub purpose: Option<String>,
    pub max_uses: Option<u32>,
    pub expires_at: Option<i64>,
}

#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AuditEntry {
    pub at: i64,
    pub secret_id: String,
    pub name: String,
    pub session_id: Option<String>,
    /// "saved", "used", "blocked", "revoked", "expired", "ended".
    pub outcome: String,
    pub action: String,
    pub method: String,
    pub host: String,
    pub detail: String,
}

impl Vault {
    pub fn open(path: &Path, key: &[u8; 32]) -> Result<Self, String> {
        if let Some(dir) = path.parent() {
            std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
        }
        let conn = open_conn(path)?;
        restrict(path);
        Self::with_conn(conn, key)
    }

    #[cfg(test)]
    pub fn open_in_memory(key: &[u8; 32]) -> Result<Self, String> {
        let conn = Connection::open_in_memory().map_err(|e| e.to_string())?;
        Self::with_conn(conn, key)
    }

    fn with_conn(conn: Connection, key: &[u8; 32]) -> Result<Self, String> {
        migrate(&conn)?;
        let key = UnboundKey::new(&AES_256_GCM, key).map_err(|_| "Invalid vault key")?;
        Ok(Self {
            conn,
            key: LessSafeKey::new(key),
        })
    }

    pub fn insert(&self, secret: &NewSecret, value: &str, now: i64) -> Result<SecretMeta, String> {
        let id = uuid::Uuid::new_v4().simple().to_string();
        let mut nonce = [0u8; NONCE_LEN];
        SystemRandom::new()
            .fill(&mut nonce)
            .map_err(|_| "Could not create a nonce")?;
        let mut sealed = Zeroizing::new(value.as_bytes().to_vec());
        self.key
            .seal_in_place_append_tag(
                Nonce::assume_unique_for_key(nonce),
                Aad::from(aad(&id, &secret.name)),
                &mut *sealed,
            )
            .map_err(|_| "Could not encrypt the value")?;
        // A chat asks again under the same name to replace its value.
        let replaced: Vec<String> = {
            let mut stmt = self
                .conn
                .prepare("SELECT id FROM secrets WHERE name = ?1 AND session_id IS ?2")
                .map_err(sql)?;
            let rows = stmt
                .query_map(params![secret.name, secret.session_id], |row| row.get(0))
                .map_err(sql)?;
            rows.collect::<Result<_, _>>().map_err(sql)?
        };
        for old in &replaced {
            self.delete(old)?;
        }
        self.conn
            .execute(
                "INSERT INTO secrets (id, name, label, description, session_id, hosts, allow_in,
                   purpose, max_uses, uses, created_at, expires_at, nonce, ciphertext)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, 0, ?10, ?11, ?12, ?13)",
                params![
                    id,
                    secret.name,
                    secret.label,
                    secret.description,
                    secret.session_id,
                    serde_json::to_string(&secret.hosts).map_err(|e| e.to_string())?,
                    serde_json::to_string(&secret.allow_in).map_err(|e| e.to_string())?,
                    secret.purpose,
                    secret.max_uses,
                    now,
                    secret.expires_at,
                    nonce.to_vec(),
                    sealed.to_vec(),
                ],
            )
            .map_err(sql)?;
        self.get(&id)?
            .ok_or_else(|| "The secret was not saved".into())
    }

    pub fn get(&self, id: &str) -> Result<Option<SecretMeta>, String> {
        self.conn
            .query_row(
                &format!("SELECT {META_COLUMNS} FROM secrets WHERE id = ?1"),
                params![id],
                meta_row,
            )
            .optional()
            .map_err(sql)
    }

    /// Every secret still usable, oldest first. Lapsed ones are deleted.
    pub fn active(&self, now: i64) -> Result<Vec<SecretMeta>, String> {
        self.purge(now)?;
        let mut stmt = self
            .conn
            .prepare(&format!(
                "SELECT {META_COLUMNS} FROM secrets ORDER BY created_at, id"
            ))
            .map_err(sql)?;
        let rows = stmt.query_map([], meta_row).map_err(sql)?;
        rows.collect::<Result<_, _>>().map_err(sql)
    }

    pub fn reveal(&self, id: &str) -> Result<Zeroizing<String>, String> {
        let (name, nonce, ciphertext): (String, Vec<u8>, Vec<u8>) = self
            .conn
            .query_row(
                "SELECT name, nonce, ciphertext FROM secrets WHERE id = ?1",
                params![id],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .optional()
            .map_err(sql)?
            .ok_or("The secret is no longer available")?;
        let nonce = Nonce::try_assume_unique_for_key(&nonce).map_err(|_| "Damaged secret")?;
        let mut buffer = Zeroizing::new(ciphertext);
        let plain = self
            .key
            .open_in_place(nonce, Aad::from(aad(id, &name)), &mut buffer)
            .map_err(|_| "The secret could not be decrypted")?;
        let text = std::str::from_utf8(plain).map_err(|_| "Damaged secret")?;
        Ok(Zeroizing::new(text.to_string()))
    }

    /// Counts one use; a value whose uses ran out is deleted. True when it
    /// was the last one.
    pub fn record_use(&self, id: &str) -> Result<bool, String> {
        self.conn
            .execute(
                "UPDATE secrets SET uses = uses + 1 WHERE id = ?1",
                params![id],
            )
            .map_err(sql)?;
        let spent = self
            .get(id)?
            .is_some_and(|meta| meta.max_uses.is_some_and(|max| meta.uses >= max));
        if spent {
            self.delete(id)?;
        }
        Ok(spent)
    }

    pub fn delete(&self, id: &str) -> Result<bool, String> {
        let n = self
            .conn
            .execute("DELETE FROM secrets WHERE id = ?1", params![id])
            .map_err(sql)?;
        Ok(n > 0)
    }

    /// Ends every value bound to a chat. Returns what was removed.
    pub fn end_session(&self, session_id: &str) -> Result<Vec<SecretMeta>, String> {
        let gone = self.by_session(session_id)?;
        self.conn
            .execute(
                "DELETE FROM secrets WHERE session_id = ?1",
                params![session_id],
            )
            .map_err(sql)?;
        Ok(gone)
    }

    fn by_session(&self, session_id: &str) -> Result<Vec<SecretMeta>, String> {
        let mut stmt = self
            .conn
            .prepare(&format!(
                "SELECT {META_COLUMNS} FROM secrets WHERE session_id = ?1"
            ))
            .map_err(sql)?;
        let rows = stmt.query_map(params![session_id], meta_row).map_err(sql)?;
        rows.collect::<Result<_, _>>().map_err(sql)
    }

    /// Deletes lapsed values and returns them.
    pub fn purge(&self, now: i64) -> Result<Vec<SecretMeta>, String> {
        purge_conn(&self.conn, now)
    }

    pub fn audit(&self, entry: &AuditEntry) -> Result<(), String> {
        audit_conn(&self.conn, entry)
    }

    pub fn audit_list(&self, limit: u32) -> Result<Vec<AuditEntry>, String> {
        let mut stmt = self
            .conn
            .prepare(
                "SELECT at, secret_id, name, session_id, outcome, action, method, host, detail
                 FROM audit ORDER BY seq DESC LIMIT ?1",
            )
            .map_err(sql)?;
        let rows = stmt
            .query_map(params![limit.clamp(1, 500)], |row| {
                Ok(AuditEntry {
                    at: row.get(0)?,
                    secret_id: row.get(1)?,
                    name: row.get(2)?,
                    session_id: row.get(3)?,
                    outcome: row.get(4)?,
                    action: row.get(5)?,
                    method: row.get(6)?,
                    host: row.get(7)?,
                    detail: row.get(8)?,
                })
            })
            .map_err(sql)?;
        rows.collect::<Result<_, _>>().map_err(sql)
    }
}

/// Removes lapsed rows without the key, so the app can sweep at any time
/// without asking the Keychain.
pub fn purge_file(path: &Path, now: i64) -> Result<(), String> {
    if !path.exists() {
        return Ok(());
    }
    let conn = open_conn(path)?;
    migrate(&conn)?;
    purge_conn(&conn, now).map(|_| ())
}

/// Whether the file holds any value at all; with none, nothing needs the key.
pub fn has_secrets(path: &Path) -> bool {
    if !path.exists() {
        return false;
    }
    open_conn(path)
        .and_then(|conn| {
            conn.query_row("SELECT EXISTS(SELECT 1 FROM secrets)", [], |row| row.get(0))
                .map_err(sql)
        })
        .unwrap_or(false)
}

fn open_conn(path: &Path) -> Result<Connection, String> {
    let conn = Connection::open(path).map_err(|e| e.to_string())?;
    conn.busy_timeout(std::time::Duration::from_secs(3))
        .map_err(sql)?;
    // Deleted ciphertext is overwritten rather than left in free pages.
    conn.pragma_update(None, "secure_delete", "ON")
        .map_err(sql)?;
    Ok(conn)
}

#[cfg(unix)]
fn restrict(path: &Path) {
    use std::os::unix::fs::PermissionsExt;
    let _ = std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600));
}
#[cfg(not(unix))]
fn restrict(_path: &Path) {}

fn purge_conn(conn: &Connection, now: i64) -> Result<Vec<SecretMeta>, String> {
    let lapsed: Vec<SecretMeta> = {
        let mut stmt = conn
            .prepare(&format!(
                "SELECT {META_COLUMNS} FROM secrets
                 WHERE (expires_at IS NOT NULL AND expires_at <= ?1)
                    OR (max_uses IS NOT NULL AND uses >= max_uses)"
            ))
            .map_err(sql)?;
        let rows = stmt.query_map(params![now], meta_row).map_err(sql)?;
        rows.collect::<Result<_, _>>().map_err(sql)?
    };
    for meta in &lapsed {
        conn.execute("DELETE FROM secrets WHERE id = ?1", params![meta.id])
            .map_err(sql)?;
        audit_conn(
            conn,
            &AuditEntry {
                at: now,
                secret_id: meta.id.clone(),
                name: meta.name.clone(),
                session_id: meta.session_id.clone(),
                outcome: "expired".into(),
                action: String::new(),
                method: String::new(),
                host: String::new(),
                detail: String::new(),
            },
        )?;
    }
    Ok(lapsed)
}

fn audit_conn(conn: &Connection, entry: &AuditEntry) -> Result<(), String> {
    conn.execute(
        "INSERT INTO audit (at, secret_id, name, session_id, outcome, action, method, host, detail)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
        params![
            entry.at,
            entry.secret_id,
            entry.name,
            entry.session_id,
            entry.outcome,
            entry.action,
            entry.method,
            entry.host,
            entry.detail,
        ],
    )
    .map_err(sql)?;
    conn.execute(
        "DELETE FROM audit WHERE seq <= (SELECT MAX(seq) FROM audit) - ?1",
        params![AUDIT_KEEP],
    )
    .map_err(sql)?;
    Ok(())
}

const META_COLUMNS: &str = "id, name, label, description, session_id, hosts, allow_in, purpose, max_uses, uses, created_at, expires_at";

fn meta_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<SecretMeta> {
    let hosts: String = row.get(5)?;
    let allow_in: String = row.get(6)?;
    Ok(SecretMeta {
        id: row.get(0)?,
        name: row.get(1)?,
        label: row.get(2)?,
        description: row.get(3)?,
        session_id: row.get(4)?,
        hosts: serde_json::from_str(&hosts).unwrap_or_default(),
        allow_in: serde_json::from_str(&allow_in).unwrap_or_default(),
        purpose: row.get(7)?,
        max_uses: row.get(8)?,
        uses: row.get(9)?,
        created_at: row.get(10)?,
        expires_at: row.get(11)?,
    })
}

fn aad(id: &str, name: &str) -> Vec<u8> {
    format!("irgatos-secret:{id}:{name}").into_bytes()
}

fn migrate(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS secrets (
           id TEXT PRIMARY KEY,
           name TEXT NOT NULL,
           label TEXT NOT NULL,
           description TEXT NOT NULL,
           session_id TEXT,
           hosts TEXT NOT NULL,
           allow_in TEXT NOT NULL,
           purpose TEXT,
           max_uses INTEGER,
           uses INTEGER NOT NULL DEFAULT 0,
           created_at INTEGER NOT NULL,
           expires_at INTEGER,
           nonce BLOB NOT NULL,
           ciphertext BLOB NOT NULL
         );
         CREATE INDEX IF NOT EXISTS secrets_session ON secrets(session_id);
         CREATE TABLE IF NOT EXISTS audit (
           seq INTEGER PRIMARY KEY AUTOINCREMENT,
           at INTEGER NOT NULL,
           secret_id TEXT NOT NULL,
           name TEXT NOT NULL,
           session_id TEXT,
           outcome TEXT NOT NULL,
           action TEXT NOT NULL,
           method TEXT NOT NULL,
           host TEXT NOT NULL,
           detail TEXT NOT NULL
         );",
    )
    .map_err(sql)
}

fn sql(error: rusqlite::Error) -> String {
    error.to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    const KEY: [u8; 32] = [7u8; 32];

    fn new_secret(name: &str, session: Option<&str>) -> NewSecret {
        NewSecret {
            name: name.into(),
            label: "Stripe".into(),
            description: String::new(),
            session_id: session.map(str::to_string),
            hosts: vec!["api.stripe.com".into()],
            allow_in: vec!["header".into()],
            purpose: None,
            max_uses: None,
            expires_at: Some(10_000),
        }
    }

    #[test]
    fn stores_only_ciphertext_and_round_trips() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("secrets.db");
        let value = "sk_test_FAKEFAKEFAKE0123456789";
        let id = {
            let vault = Vault::open(&path, &KEY).unwrap();
            let meta = vault
                .insert(&new_secret("STRIPE_KEY", Some("s1")), value, 1)
                .unwrap();
            assert_eq!(&*vault.reveal(&meta.id).unwrap(), value);
            meta.id
        };
        let bytes = std::fs::read(&path).unwrap();
        assert!(
            !bytes.windows(value.len()).any(|w| w == value.as_bytes()),
            "plaintext found in the database file"
        );
        // Another key cannot read it.
        let other = Vault::open(&path, &[9u8; 32]).unwrap();
        assert!(other.reveal(&id).is_err());
    }

    #[test]
    fn lapsed_and_spent_values_are_deleted() {
        let vault = Vault::open_in_memory(&KEY).unwrap();
        let short = vault
            .insert(&new_secret("A_KEY", Some("s1")), "value-one", 1)
            .unwrap();
        let mut once = new_secret("B_KEY", Some("s1"));
        once.max_uses = Some(1);
        once.expires_at = None;
        let once = vault.insert(&once, "value-two", 1).unwrap();
        assert_eq!(vault.active(5).unwrap().len(), 2);
        assert!(vault.record_use(&once.id).unwrap());
        assert!(vault.reveal(&once.id).is_err());
        assert!(vault.active(10_000).unwrap().is_empty());
        assert!(vault.reveal(&short.id).is_err());
        let audit = vault.audit_list(10).unwrap();
        assert!(audit
            .iter()
            .any(|e| e.name == "A_KEY" && e.outcome == "expired"));
    }

    #[test]
    fn ending_a_chat_removes_only_its_values() {
        let vault = Vault::open_in_memory(&KEY).unwrap();
        vault
            .insert(&new_secret("A_KEY", Some("s1")), "value-one", 1)
            .unwrap();
        vault
            .insert(&new_secret("A_KEY", Some("s2")), "value-two", 1)
            .unwrap();
        let mut kept = new_secret("C_KEY", None);
        kept.expires_at = None;
        vault.insert(&kept, "value-three", 1).unwrap();
        assert_eq!(vault.end_session("s1").unwrap().len(), 1);
        let mut names: Vec<_> = vault
            .active(2)
            .unwrap()
            .into_iter()
            .map(|m| (m.name, m.session_id))
            .collect();
        names.sort();
        assert_eq!(
            names,
            vec![("A_KEY".into(), Some("s2".into())), ("C_KEY".into(), None)]
        );
    }

    #[test]
    fn asking_again_replaces_the_chats_value() {
        let vault = Vault::open_in_memory(&KEY).unwrap();
        vault
            .insert(&new_secret("A_KEY", Some("s1")), "first-value", 1)
            .unwrap();
        let second = vault
            .insert(&new_secret("A_KEY", Some("s1")), "second-value", 2)
            .unwrap();
        let active = vault.active(3).unwrap();
        assert_eq!(active.len(), 1);
        assert_eq!(&*vault.reveal(&second.id).unwrap(), "second-value");
    }
}
